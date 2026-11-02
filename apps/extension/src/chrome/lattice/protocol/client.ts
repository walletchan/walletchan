/**
 * Lattice protocol client: connect, pair, getAddresses and generic signing.
 *
 * Ported from ape-grid-lattice `ape_grid/protocol/client.py`. It keeps the
 * ephemeral key in memory only; callers persist just the app private key and
 * public device metadata. A Manifest V3 worker may stop between operations, so
 * every operation should start with `connect()`.
 */
import { concat } from "viem";

import {
  LATTICE_DEFAULT_APP_NAME,
  LatticeEncryptedRequestType,
  LatticeResponseCode,
  LatticeSignCurve,
  LatticeSignSchema,
  type LatticeSignEncoding,
  type LatticeSignHash,
} from "./constants";
import {
  buildConnectRequest,
  buildEncryptedRequest,
  decodeGetAddressesResponse,
  decryptLatticeResponse,
  encodeGenericSigningRequest,
  encodeGetAddressesRequest,
  encodePersonalSignRequest,
  encodeSignEnvelope,
  newLatticeMsgId,
  parseEthMsgSignResponse,
  parseGenericSigningResponseSecp256k1,
  parseLatticeResponse,
  type LatticeSecpSignResponse,
} from "./encoding";
import { LatticeProtocolError } from "./errors";
import {
  formatLatticeFirmware,
  isSupportedLatticeFirmware,
  LATTICE_FW_DEFAULT,
  LATTICE_MIN_FIRMWARE,
  type LatticeFirmwareConstants,
} from "./firmware";
import { decodeConnectResponse, encodePairRequest, type LatticeConnectResult } from "./pairing";
import { assertLatticeAppPrivateKey, assertUncompressedP256, latticeAppPublicKey, latticeSharedSecret } from "./secureChannel";
import type { LatticeTransport } from "./transport";

const DEVICE_BUSY_RETRY_MS = 3_000;

export interface LatticeClientOptions {
  appPrivateKey: Uint8Array;
  transport: LatticeTransport;
  appName?: string;
  firmware?: LatticeFirmwareConstants;
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface LatticeGenericSignInput {
  signerPath: readonly number[];
  payload: Uint8Array;
  hashType: LatticeSignHash;
  encoding: LatticeSignEncoding;
  decoder?: Uint8Array;
  signal?: AbortSignal;
}

export interface LatticeGenericSignResult extends LatticeSecpSignResponse {
  prehashed: boolean;
  decoderAttached: boolean;
}

export interface LatticePersonalSignResult {
  r: Uint8Array;
  s: Uint8Array;
  /** 20-byte address the device reports it signed with. */
  signer: Uint8Array;
  prehashed: boolean;
  displayHex: boolean;
}

export class LatticeProtocolClient {
  private readonly appPrivateKey: Uint8Array;
  private readonly transport: LatticeTransport;
  private readonly appName: string;
  private readonly fw: LatticeFirmwareConstants;
  private readonly retries: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private ephemeralPub: Uint8Array | null = null;
  private connectResult: LatticeConnectResult | null = null;

  constructor(options: LatticeClientOptions) {
    assertLatticeAppPrivateKey(options.appPrivateKey);
    this.appPrivateKey = options.appPrivateKey;
    this.transport = options.transport;
    this.appName = options.appName ?? LATTICE_DEFAULT_APP_NAME;
    this.fw = options.firmware ?? LATTICE_FW_DEFAULT;
    this.retries = options.retries ?? 2;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  get appPublicKey(): Uint8Array {
    return latticeAppPublicKey(this.appPrivateKey);
  }

  /**
   * CONNECT. A paired app gets the active wallet UIDs. An unpaired app puts the
   * device in pairing mode; call `pair()` with the code on its screen.
   */
  async connect(signal?: AbortSignal): Promise<LatticeConnectResult> {
    const frame = buildConnectRequest(this.appPublicKey, newLatticeMsgId());
    const parsed = parseLatticeResponse(await this.transport.send(frame, signal));
    if (parsed.responseCode !== LatticeResponseCode.SUCCESS) {
      throw LatticeProtocolError.fromResponseCode(parsed.responseCode);
    }
    const result = await decodeConnectResponse(parsed.data, this.appPrivateKey);
    if (!isSupportedLatticeFirmware(result.firmware)) {
      throw new LatticeProtocolError(
        `Lattice firmware ${formatLatticeFirmware(result.firmware)} is older than the supported minimum ${formatLatticeFirmware(LATTICE_MIN_FIRMWARE)}.`,
      );
    }
    this.ephemeralPub = result.ephemeralPub;
    this.connectResult = result;
    return result;
  }

  /** Completes pairing, then reconnects to load the active wallet. */
  async pair(pairingCode: string, signal?: AbortSignal): Promise<LatticeConnectResult> {
    const payload = encodePairRequest(this.appPrivateKey, this.appName, pairingCode);
    await this.encryptedRequest(LatticeEncryptedRequestType.FINALIZE_PAIRING, payload, signal);
    const result = await this.connect(signal);
    if (!result.isPaired) throw new LatticeProtocolError("Lattice did not confirm pairing.");
    return result;
  }

  async getAddresses(input: {
    startPath: readonly number[];
    n: number;
    iterIdx?: number;
    signal?: AbortSignal;
  }): Promise<string[]> {
    const payload = encodeGetAddressesRequest({
      walletUid: this.requireActiveWallet(),
      startPath: input.startPath,
      n: input.n,
      iterIdx: input.iterIdx,
    });
    const data = await this.encryptedRequest(LatticeEncryptedRequestType.GET_ADDRESSES, payload, input.signal);
    return decodeGetAddressesResponse(data);
  }

  /** Generic secp256k1 signing, chaining EXTRA_DATA frames for large payloads. */
  async signGeneric(input: LatticeGenericSignInput): Promise<LatticeGenericSignResult> {
    const request = encodeGenericSigningRequest({
      signerPath: input.signerPath,
      payload: input.payload,
      curve: LatticeSignCurve.SECP256K1,
      hashType: input.hashType,
      encoding: input.encoding,
      fw: this.fw,
      decoder: input.decoder,
    });
    const data = await this.sendSignFrames(LatticeSignSchema.GENERIC, request.base, request.extraPayloads, input.signal);
    return {
      ...parseGenericSigningResponseSecp256k1(data),
      prehashed: request.prehashed,
      decoderAttached: request.decoderAttached,
    };
  }

  /** ETH_MSG personal_sign: the device adds the EIP-191 prefix and shows ASCII messages as text. */
  async signPersonal(input: {
    signerPath: readonly number[];
    message: Uint8Array;
    signal?: AbortSignal;
  }): Promise<LatticePersonalSignResult> {
    const request = encodePersonalSignRequest({ signerPath: input.signerPath, message: input.message, fw: this.fw });
    const data = await this.sendSignFrames(LatticeSignSchema.ETH_MSG, request.base, request.extraPayloads, input.signal);
    return { ...parseEthMsgSignResponse(data), prehashed: request.prehashed, displayHex: request.displayHex };
  }

  /** Sends the base request, then chains EXTRA_DATA frames; returns the final reply. */
  private async sendSignFrames(
    schema: number,
    base: Uint8Array,
    extraPayloads: readonly Uint8Array[],
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    const extras = [...extraPayloads];
    let data = await this.sendSignEnvelope(schema, base, extras.length > 0, signal);
    while (extras.length > 0) {
      const reqPayload = concat([data.slice(0, 8), extras.shift() as Uint8Array]);
      data = await this.sendSignEnvelope(LatticeSignSchema.EXTRA_DATA, reqPayload, extras.length > 0, signal);
    }
    return data;
  }

  private requireActiveWallet(): Uint8Array {
    const uid = this.connectResult?.activeWalletUid;
    if (!uid) throw new LatticeProtocolError("No active Lattice wallet. Connect and pair first.");
    return uid;
  }

  private sendSignEnvelope(schema: number, reqPayload: Uint8Array, hasExtra: boolean, signal?: AbortSignal): Promise<Uint8Array> {
    const envelope = encodeSignEnvelope({
      schema,
      walletUid: this.requireActiveWallet(),
      reqPayload,
      hasExtraPayloads: hasExtra,
      reqMaxDataSz: this.fw.reqMaxDataSz,
    });
    return this.encryptedRequest(LatticeEncryptedRequestType.SIGN, envelope, signal);
  }

  /** Sends one encrypted request; reconnects on INVALID_EPHEM_ID and waits on DEVICE_BUSY. */
  private async encryptedRequest(
    requestType: LatticeEncryptedRequestType,
    requestData: Uint8Array,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    let lastError: LatticeProtocolError | null = null;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      if (signal?.aborted) throw new LatticeProtocolError("Lattice request was cancelled.");
      if (!this.ephemeralPub) throw new LatticeProtocolError("Not connected to the Lattice.");
      const secret = latticeSharedSecret(this.appPrivateKey, this.ephemeralPub);
      const frame = await buildEncryptedRequest(requestType, requestData, secret, newLatticeMsgId());
      const parsed = parseLatticeResponse(await this.transport.send(frame, signal));
      if (parsed.responseCode === LatticeResponseCode.SUCCESS) {
        const decrypted = await decryptLatticeResponse(parsed.data, requestType, secret);
        assertUncompressedP256(decrypted.newEphemeralPub);
        this.ephemeralPub = decrypted.newEphemeralPub;
        return decrypted.data;
      }
      lastError = LatticeProtocolError.fromResponseCode(parsed.responseCode);
      if (parsed.responseCode === LatticeResponseCode.INVALID_EPHEM_ID) {
        await this.connect(signal);
        continue;
      }
      if (parsed.responseCode === LatticeResponseCode.DEVICE_BUSY) {
        await this.sleep(DEVICE_BUSY_RETRY_MS);
        continue;
      }
      throw lastError;
    }
    throw lastError ?? new LatticeProtocolError("Lattice request failed.");
  }
}
