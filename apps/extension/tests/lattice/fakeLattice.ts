/**
 * In-process Lattice1 simulator for no-device tests.
 *
 * It speaks the real wire protocol: CRC-checked frames, ECDH + AES-256-CBC,
 * ephemeral-key rotation, P-256 pairing-signature verification, EXTRA_DATA
 * reassembly, prehash detection and secp256k1 signing with per-path keys, for
 * both generic signing and ETH_MSG personal_sign. Its P-256 side uses Node's
 * OpenSSL crypto, independent of the WebCrypto code under test.
 */
import { createECDH, createPublicKey, generateKeyPairSync, verify as verifySignature, type ECDH } from "node:crypto";
import { bytesToHex, concat, hashMessage, hashTypedData, hexToBytes, keccak256, sha256, toBytes } from "viem";
import { privateKeyToAccount, privateKeyToAddress, publicKeyToAddress, sign as signDigest } from "viem/accounts";

import { decodeCbor } from "./cbor";
import {
  LATTICE_FW_DEFAULT,
  LatticeEncryptedRequestType,
  LatticeResponseCode,
  LatticeSignHash,
  LatticeSignSchema,
  crc32Lattice,
  gsMaxExpandedSize,
  latticeAesDecrypt,
  latticeAesEncrypt,
  encodeDerSignature,
  latticeEphemeralId,
  type LatticeTransport,
} from "./protocolImports";

const RESPONSE_SIZES: Record<number, number> = { 0: 0, 1: 1290, 3: 1090 };
const REQUEST_SIZES: Record<number, number> = { 0: 99, 1: 54, 3: 1680 };

function u32be(buf: Uint8Array, off: number): number {
  return new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(off, false);
}
function u32le(buf: Uint8Array, off: number): number {
  return new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(off, true);
}
function u16le(buf: Uint8Array, off: number): number {
  return new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint16(off, true);
}
function writeU32BE(buf: Uint8Array, off: number, v: number): void {
  new DataView(buf.buffer, buf.byteOffset, buf.byteLength).setUint32(off, v >>> 0, false);
}

function newEphemeralKey(): ECDH {
  const key = createECDH("prime256v1");
  key.generateKeys();
  return key;
}

/** A P-256 app key (scalar, then uncompressed point) from Node's crypto, synchronously. */
export function testLatticeAppKey(): Uint8Array {
  const jwk = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "jwk" });
  return new Uint8Array(
    Buffer.concat([Buffer.from(jwk.d!, "base64url"), Buffer.of(0x04), Buffer.from(jwk.x!, "base64url"), Buffer.from(jwk.y!, "base64url")]),
  );
}

/** secp256k1 signature over a digest, DER encoded, plus the signer's uncompressed public key. */
async function secp256k1Sign(digest: Uint8Array, key: Uint8Array): Promise<{ der: Uint8Array; publicKey: Uint8Array }> {
  const privateKey = bytesToHex(key);
  const sig = await signDigest({ hash: bytesToHex(digest), privateKey });
  return {
    der: encodeDerSignature(hexToBytes(sig.r), hexToBytes(sig.s)),
    publicKey: hexToBytes(privateKeyToAccount(privateKey).publicKey),
  };
}

export interface FakeSignRecord {
  /** LatticeSignSchema.GENERIC or ETH_MSG. */
  schema: number;
  /** ETH_MSG only: true when the device would show hex instead of text. */
  displayHex: boolean | null;
  signerPath: number[];
  encoding: number;
  hashType: number;
  payloadDataSz: number;
  /** Full message the device hashed, or null when it received a prehash. */
  message: Uint8Array | null;
  digest: Uint8Array;
  decoder: Uint8Array | null;
  extraFrames: number;
  /** ETH_MSG typedData: the typed data the device would show, or null when it got a digest. */
  typedData?: Record<string, unknown> | null;
}

export interface FakeLatticeOptions {
  paired?: boolean;
  pairingCode?: string;
  firmware?: [number, number, number];
  safeCardInserted?: boolean;
  /** Return this digest instead of the real one (tamper test). */
  forgedDigest?: Uint8Array;
  omitDigest?: boolean;
  /** ETH_MSG: report this 20-byte signer instead of the real one (tamper test). */
  forgedSigner?: Uint8Array;
  /** Answer ETH_MSG typedData requests with INVALID_MSG, like firmware that cannot parse them. */
  rejectTypedData?: boolean;
  /** Answer generic signing requests that carry a calldata decoder with INVALID_MSG. */
  rejectDecoder?: boolean;
  /** Encrypted wallet-info bytes in CONNECT; firmware 0.18.9 sends 144. */
  walletInfoSize?: number;
}

export class FakeLattice implements LatticeTransport {
  readonly internalUid = keccak256(toBytes("internal-wallet"), "bytes");
  readonly externalUid = keccak256(toBytes("safecard-wallet"), "bytes");
  readonly signRecords: FakeSignRecord[] = [];
  /**
   * ETH_MSG sign envelopes exactly as received, plus each EXTRA_DATA frame
   * (`length(4 LE) | frame`, without the random next code). Parity fixtures
   * compare these bytes across clients.
   */
  readonly ethMsgCaptures: Array<{ envelope: Uint8Array; extras: Uint8Array[] }> = [];
  requestCount = 0;
  connectCount = 0;
  pairedAppName: string | null = null;

  private appPub: Uint8Array | null = null;
  private eph = newEphemeralKey();
  private paired: boolean;
  private readonly pairingCode: string;
  private readonly firmware: [number, number, number];
  private safeCardInserted: boolean;
  private readonly forgedDigest?: Uint8Array;
  private readonly omitDigest: boolean;
  private readonly forgedSigner?: Uint8Array;
  private readonly rejectTypedData: boolean;
  private readonly rejectDecoder: boolean;
  private readonly walletInfoSize: number;
  private readonly queuedCodes: number[] = [];
  private pendingSign: {
    schema: number;
    head: Uint8Array;
    collected: Uint8Array[];
    nextCode: Uint8Array;
    extraFrames: number;
  } | null = null;

  constructor(options: FakeLatticeOptions = {}) {
    this.paired = options.paired ?? true;
    this.pairingCode = options.pairingCode ?? "ABCD1234";
    this.firmware = options.firmware ?? [0, 18, 2];
    this.safeCardInserted = options.safeCardInserted ?? false;
    this.forgedDigest = options.forgedDigest;
    this.omitDigest = options.omitDigest ?? false;
    this.forgedSigner = options.forgedSigner;
    this.rejectTypedData = options.rejectTypedData ?? false;
    this.rejectDecoder = options.rejectDecoder ?? false;
    this.walletInfoSize = options.walletInfoSize ?? 144;
  }

  get activeUid(): Uint8Array {
    return this.safeCardInserted ? this.externalUid : this.internalUid;
  }

  setSafeCard(inserted: boolean): void {
    this.safeCardInserted = inserted;
  }

  /** Next encrypted request fails with this response code. */
  queueError(code: number): void {
    this.queuedCodes.push(code);
  }

  /** Device forgets the session key, as after a reboot. */
  desync(): void {
    this.eph = newEphemeralKey();
  }

  /** Deterministic secp256k1 key per (wallet, path). */
  keyFor(path: readonly number[]): Uint8Array {
    const pathBytes = new Uint8Array(path.length * 4);
    path.forEach((v, i) => writeU32BE(pathBytes, i * 4, v));
    return keccak256(concat([this.activeUid, pathBytes]), "bytes");
  }

  addressFor(path: readonly number[]): `0x${string}` {
    return privateKeyToAddress(bytesToHex(this.keyFor(path)));
  }

  async send(frame: Uint8Array): Promise<Uint8Array> {
    this.requestCount += 1;
    if (crc32Lattice(frame.subarray(0, frame.length - 4)) !== u32be(frame, frame.length - 4)) {
      throw new Error("fake lattice: bad request checksum");
    }
    if (frame[0] !== 0x01 || frame[1] !== 0x02) throw new Error("fake lattice: bad header");
    const msgId = frame.slice(2, 6);
    const secureType = frame[8];
    const data = frame.subarray(9, frame.length - 4);
    if (secureType === 0x01) return this.respond(msgId, await this.handleConnect(data));
    if (secureType === 0x02) return this.respond(msgId, await this.handleEncrypted(data));
    throw new Error("fake lattice: unknown secure type");
  }

  private respond(msgId: Uint8Array, payload: Uint8Array): Uint8Array {
    const body = new Uint8Array(8 + payload.length);
    body[0] = 0x01;
    body[1] = 0x00;
    body.set(msgId, 2);
    new DataView(body.buffer).setUint16(6, payload.length, false);
    body.set(payload, 8);
    const out = new Uint8Array(body.length + 4);
    out.set(body);
    writeU32BE(out, body.length, crc32Lattice(body));
    return out;
  }

  private errorPayload(code: number): Uint8Array {
    return Uint8Array.from([code]);
  }

  private async handleConnect(data: Uint8Array): Promise<Uint8Array> {
    this.connectCount += 1;
    this.appPub = data.slice(0, 65);
    this.eph = newEphemeralKey();
    const ephPub = new Uint8Array(this.eph.getPublicKey());
    const fw = Uint8Array.from([this.firmware[2], this.firmware[1], this.firmware[0], 0]);
    const head = concat([Uint8Array.from([0, this.paired ? 1 : 0]), ephPub, fw]);
    if (!this.paired) return head;
    const wallets = new Uint8Array(this.walletInfoSize);
    wallets.set(this.internalUid, 0);
    if (this.safeCardInserted) wallets.set(this.externalUid, 71);
    return concat([head, await latticeAesEncrypt(wallets, this.sharedSecret())]);
  }

  /** ECDH x-coordinate with the app key, as the firmware derives it. */
  private sharedSecret(): Uint8Array {
    return new Uint8Array(this.eph.computeSecret(this.appPub as Uint8Array));
  }

  private async handleEncrypted(data: Uint8Array): Promise<Uint8Array> {
    if (!this.appPub) return this.errorPayload(LatticeResponseCode.INVALID_EPHEM_ID);
    const secret = this.sharedSecret();
    if (u32le(data, 0) !== latticeEphemeralId(secret)) {
      return this.errorPayload(LatticeResponseCode.INVALID_EPHEM_ID);
    }
    const queued = this.queuedCodes.shift();
    if (queued !== undefined) return this.errorPayload(queued);

    const plain = await latticeAesDecrypt(data.subarray(4, 4 + 1728), secret);
    const requestType = plain[0];
    const size = REQUEST_SIZES[requestType];
    if (size === undefined) return this.errorPayload(LatticeResponseCode.INVALID_MSG);
    if (crc32Lattice(plain.subarray(0, 1 + size)) !== u32le(plain, 1 + size)) {
      return this.errorPayload(LatticeResponseCode.INVALID_MSG);
    }
    const request = plain.slice(1, 1 + size);

    let result: Uint8Array | number;
    if (requestType === LatticeEncryptedRequestType.FINALIZE_PAIRING) result = this.handlePair(request);
    else if (!this.paired) result = LatticeResponseCode.PERMISSION_DISABLED;
    else if (requestType === LatticeEncryptedRequestType.GET_ADDRESSES) result = this.handleGetAddresses(request);
    else result = await this.handleSign(request);
    if (typeof result === "number") return this.errorPayload(result);

    // Encrypt [newEphPub][data][crc BE] with the request's secret, then rotate.
    const next = newEphemeralKey();
    const out = new Uint8Array(1728);
    out.set(next.getPublicKey(), 0);
    out.set(result.subarray(0, RESPONSE_SIZES[requestType]), 65);
    const checksumOff = 65 + RESPONSE_SIZES[requestType];
    writeU32BE(out, checksumOff, crc32Lattice(out.subarray(0, checksumOff)));
    const cipher = await latticeAesEncrypt(out, secret);
    this.eph = next;
    return concat([Uint8Array.from([0]), cipher, new Uint8Array(1728)]);
  }

  private handlePair(request: Uint8Array): Uint8Array | number {
    const nameBuf = request.subarray(0, 25);
    const der = request.subarray(25, 99);
    const trimmed = der.subarray(0, 2 + der[1]);
    const appPub = this.appPub as Uint8Array;
    const appKey = createPublicKey({
      key: {
        kty: "EC",
        crv: "P-256",
        x: Buffer.from(appPub.subarray(1, 33)).toString("base64url"),
        y: Buffer.from(appPub.subarray(33, 65)).toString("base64url"),
      },
      format: "jwk",
    });
    const preimage = concat([appPub, nameBuf, toBytes(this.pairingCode)]);
    const ok = verifySignature("sha256", preimage, { key: appKey, dsaEncoding: "der" }, trimmed);
    if (!ok) return LatticeResponseCode.PAIR_FAILED;
    this.paired = true;
    this.pairedAppName = new TextDecoder().decode(nameBuf.subarray(0, nameBuf.indexOf(0) < 0 ? 25 : nameBuf.indexOf(0)));
    return new Uint8Array(0);
  }

  private handleGetAddresses(request: Uint8Array): Uint8Array | number {
    const uid = request.subarray(0, 32);
    if (!uid.every((b, i) => b === this.activeUid[i])) return LatticeResponseCode.WRONG_WALLET;
    const depth = request[32] & 0x0f;
    const n = request[53] & 0x0f;
    const path = Array.from({ length: depth }, (_, i) => u32be(request, 33 + 4 * i));
    const out = new Uint8Array(1290);
    for (let i = 0; i < n; i += 1) {
      const p = [...path];
      p[p.length - 1] += i;
      out.set(new TextEncoder().encode(this.addressFor(p)), i * 129);
    }
    return out;
  }

  private async handleSign(request: Uint8Array): Promise<Uint8Array | number> {
    const hasExtra = request[0] === 1;
    const schema = request[1];
    const uid = request.subarray(2, 34);
    if (!uid.every((b, i) => b === this.activeUid[i])) return LatticeResponseCode.WRONG_WALLET;
    const reqPayload = request.subarray(34);

    if (schema === LatticeSignSchema.GENERIC || schema === LatticeSignSchema.ETH_MSG) {
      if (schema === LatticeSignSchema.ETH_MSG) this.ethMsgCaptures.push({ envelope: request.slice(), extras: [] });
      const head = reqPayload.slice(
        0,
        schema === LatticeSignSchema.GENERIC ? LATTICE_FW_DEFAULT.gsBaseReqSz : 28 + LATTICE_FW_DEFAULT.ethMsgMaxBaseSz,
      );
      if (!hasExtra) return this.complete(schema, head, [], 0);
      this.pendingSign = { schema, head, collected: [], nextCode: crypto.getRandomValues(new Uint8Array(8)), extraFrames: 0 };
      const resp = new Uint8Array(1090);
      resp.set(this.pendingSign.nextCode);
      return resp;
    }
    if (schema === LatticeSignSchema.EXTRA_DATA) {
      const pending = this.pendingSign;
      if (!pending) return LatticeResponseCode.INVALID_MSG;
      if (!reqPayload.subarray(0, 8).every((b, i) => b === pending.nextCode[i])) return LatticeResponseCode.INVALID_MSG;
      const len = u32le(reqPayload, 8);
      if (pending.schema === LatticeSignSchema.ETH_MSG) this.ethMsgCaptures.at(-1)?.extras.push(reqPayload.slice(8, 12 + len));
      pending.collected.push(reqPayload.slice(12, 12 + len));
      pending.extraFrames += 1;
      if (hasExtra) {
        pending.nextCode = crypto.getRandomValues(new Uint8Array(8));
        const resp = new Uint8Array(1090);
        resp.set(pending.nextCode);
        return resp;
      }
      this.pendingSign = null;
      return this.complete(pending.schema, pending.head, pending.collected, pending.extraFrames);
    }
    return LatticeResponseCode.INVALID_MSG;
  }

  private async complete(schema: number, head: Uint8Array, extras: Uint8Array[], extraFrames: number): Promise<Uint8Array | number> {
    if (schema !== LatticeSignSchema.ETH_MSG) return this.sign(head, extras, extraFrames);
    if (head[0] === 0) return this.signPersonal(head, extras, extraFrames);
    if (head[0] === 1 && !this.rejectTypedData) return this.signTypedData(head, extras, extraFrames);
    return LatticeResponseCode.INVALID_MSG;
  }

  /**
   * ETH_MSG typedData: protocol(1)=1 | signerPath(24) | cborLen(2 LE) | CBOR, or the
   * EIP-712 digest when too large. Decodes the CBOR the way the firmware must:
   * bignums back to integers, byte strings to hex, 1/0 to booleans.
   */
  private async signTypedData(head: Uint8Array, extras: Uint8Array[], extraFrames: number): Promise<Uint8Array | number> {
    try {
      return await this.signTypedDataUnchecked(head, extras, extraFrames);
    } catch {
      return LatticeResponseCode.INVALID_MSG;
    }
  }

  private async signTypedDataUnchecked(head: Uint8Array, extras: Uint8Array[], extraFrames: number): Promise<Uint8Array> {
    const fw = LATTICE_FW_DEFAULT;
    const depth = u32le(head, 1);
    const signerPath = Array.from({ length: depth }, (_, i) => u32le(head, 5 + 4 * i));
    const payloadDataSz = u16le(head, 25);
    let typedData: Record<string, unknown> | null = null;
    let digest: Uint8Array;
    if (payloadDataSz > fw.ethMsgMaxBaseSz + fw.extraDataMaxFrames * fw.extraDataFrameSz) {
      digest = head.slice(27, 59);
    } else {
      const cbor = concat([head.subarray(27, 27 + fw.ethMsgMaxBaseSz), ...extras]).slice(0, payloadDataSz);
      const decoded = decodeCbor(cbor) as { types: Record<string, Array<{ name: string; type: string }>>; primaryType: string; domain: unknown; message: unknown };
      const fromDevice = (value: unknown, type: string): unknown => {
        if (type.endsWith("]")) return (value as unknown[]).map((item) => fromDevice(item, type.slice(0, type.lastIndexOf("["))));
        const fields = decoded.types[type];
        if (fields) return Object.fromEntries(fields.map((f) => [f.name, fromDevice((value as Record<string, unknown>)[f.name], f.type)]));
        if (type === "bool") return value === 1;
        if (value instanceof Uint8Array) return bytesToHex(value);
        return value;
      };
      typedData = {
        types: decoded.types,
        primaryType: decoded.primaryType,
        domain: fromDevice(decoded.domain, "EIP712Domain"),
        message: fromDevice(decoded.message, decoded.primaryType),
      };
      digest = hexToBytes(hashTypedData(typedData as never));
    }
    this.signRecords.push({
      schema: LatticeSignSchema.ETH_MSG,
      displayHex: null,
      signerPath,
      encoding: 0,
      hashType: LatticeSignHash.KECCAK256,
      payloadDataSz,
      message: null,
      digest,
      decoder: null,
      extraFrames,
      typedData,
    });
    return this.ethMsgReply(digest, signerPath);
  }

  private async ethMsgReply(digest: Uint8Array, signerPath: number[]): Promise<Uint8Array> {
    const { der, publicKey } = await secp256k1Sign(digest, this.keyFor(signerPath));
    const resp = new Uint8Array(1090);
    resp.set(der, 0);
    resp.set(this.forgedSigner ?? hexToBytes(publicKeyToAddress(bytesToHex(publicKey))), 74);
    return resp;
  }

  /** ETH_MSG: protocol(1) | signerPath(24) | displayHex(1) | msgLen(2 LE) | message or EIP-191 digest. */
  private async signPersonal(head: Uint8Array, extras: Uint8Array[], extraFrames: number): Promise<Uint8Array | number> {
    const fw = LATTICE_FW_DEFAULT;
    const depth = u32le(head, 1);
    const signerPath = Array.from({ length: depth }, (_, i) => u32le(head, 5 + 4 * i));
    const payloadDataSz = u16le(head, 26);
    const maxFull = fw.ethMsgMaxBaseSz + fw.extraDataMaxFrames * fw.extraDataFrameSz - fw.personalSignHeaderSz;
    let message: Uint8Array | null = null;
    let digest: Uint8Array;
    if (payloadDataSz > maxFull) {
      digest = head.slice(28, 60);
    } else {
      message = concat([head.subarray(28, 28 + fw.ethMsgMaxBaseSz), ...extras]).slice(0, payloadDataSz);
      digest = hashMessage({ raw: message }, "bytes");
    }
    this.signRecords.push({
      schema: LatticeSignSchema.ETH_MSG,
      displayHex: head[25] === 1,
      signerPath,
      encoding: 0,
      hashType: LatticeSignHash.KECCAK256,
      payloadDataSz,
      message,
      digest,
      decoder: null,
      extraFrames,
    });
    return this.ethMsgReply(digest, signerPath);
  }

  private async sign(head: Uint8Array, extras: Uint8Array[], extraFrames: number): Promise<Uint8Array | number> {
    const encoding = u32le(head, 0);
    const hashType = head[4];
    const depth = u32le(head, 6);
    const signerPath = Array.from({ length: depth }, (_, i) => u32le(head, 10 + 4 * i));
    const payloadDataSz = u16le(head, 31);
    const baseData = head.subarray(33, 33 + LATTICE_FW_DEFAULT.gsBaseDataSz);
    const full = concat([baseData, ...extras]);

    let message: Uint8Array | null = null;
    let digest: Uint8Array;
    let decoder: Uint8Array | null = null;
    if (payloadDataSz > gsMaxExpandedSize(LATTICE_FW_DEFAULT)) {
      digest = full.slice(0, 32);
    } else {
      message = full.slice(0, payloadDataSz);
      digest = hashType === LatticeSignHash.SHA256 ? sha256(message, "bytes") : keccak256(message, "bytes");
      const tail = full.subarray(payloadDataSz);
      if (tail.length >= 8 && u32le(tail, 0) === LATTICE_FW_DEFAULT.decoderReserved) {
        decoder = tail.slice(8, 8 + u32le(tail, 4));
      }
    }
    if (decoder && this.rejectDecoder) return LatticeResponseCode.INVALID_MSG;
    this.signRecords.push({
      schema: LatticeSignSchema.GENERIC,
      displayHex: null,
      signerPath,
      encoding,
      hashType,
      payloadDataSz,
      message,
      digest,
      decoder,
      extraFrames,
    });

    const { der, publicKey } = await secp256k1Sign(digest, this.keyFor(signerPath));
    const resp = new Uint8Array(1090);
    resp.set(publicKey, 0);
    resp.set(der, 65);
    if (!this.omitDigest) resp.set(this.forgedDigest ?? digest, 65 + 74);
    return resp;
  }
}
