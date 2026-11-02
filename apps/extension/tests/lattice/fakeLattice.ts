/**
 * In-process Lattice1 simulator for no-device tests.
 *
 * It speaks the real wire protocol: CRC-checked frames, ECDH + AES-256-CBC,
 * ephemeral-key rotation, P-256 pairing-signature verification, EXTRA_DATA
 * reassembly, prehash detection and secp256k1 signing with per-path keys.
 */
import { p256 } from "@noble/curves/p256";
import { secp256k1 } from "@noble/curves/secp256k1";
import { bytesToHex, concat, keccak256, sha256, toBytes } from "viem";
import { publicKeyToAddress } from "viem/accounts";

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
  latticeEphemeralId,
  latticeSharedSecret,
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

export interface FakeSignRecord {
  signerPath: number[];
  encoding: number;
  hashType: number;
  payloadDataSz: number;
  /** Full message the device hashed, or null when it received a prehash. */
  message: Uint8Array | null;
  digest: Uint8Array;
  decoder: Uint8Array | null;
  extraFrames: number;
}

export interface FakeLatticeOptions {
  paired?: boolean;
  pairingCode?: string;
  firmware?: [number, number, number];
  safeCardInserted?: boolean;
  /** Return this digest instead of the real one (tamper test). */
  forgedDigest?: Uint8Array;
  omitDigest?: boolean;
}

export class FakeLattice implements LatticeTransport {
  readonly internalUid = keccak256(toBytes("internal-wallet"), "bytes");
  readonly externalUid = keccak256(toBytes("safecard-wallet"), "bytes");
  readonly signRecords: FakeSignRecord[] = [];
  requestCount = 0;
  connectCount = 0;
  pairedAppName: string | null = null;

  private appPub: Uint8Array | null = null;
  private ephPriv = p256.utils.randomPrivateKey();
  private paired: boolean;
  private readonly pairingCode: string;
  private readonly firmware: [number, number, number];
  private safeCardInserted: boolean;
  private readonly forgedDigest?: Uint8Array;
  private readonly omitDigest: boolean;
  private readonly queuedCodes: number[] = [];
  private pendingSign: {
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
    this.ephPriv = p256.utils.randomPrivateKey();
  }

  /** Deterministic secp256k1 key per (wallet, path). */
  keyFor(path: readonly number[]): Uint8Array {
    const pathBytes = new Uint8Array(path.length * 4);
    path.forEach((v, i) => writeU32BE(pathBytes, i * 4, v));
    return keccak256(concat([this.activeUid, pathBytes]), "bytes");
  }

  addressFor(path: readonly number[]): `0x${string}` {
    return publicKeyToAddress(bytesToHex(secp256k1.getPublicKey(this.keyFor(path), false)));
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
    this.ephPriv = p256.utils.randomPrivateKey();
    const ephPub = p256.getPublicKey(this.ephPriv, false);
    const fw = Uint8Array.from([this.firmware[2], this.firmware[1], this.firmware[0], 0]);
    const head = concat([Uint8Array.from([0, this.paired ? 1 : 0]), ephPub, fw]);
    if (!this.paired) return head;
    const wallets = new Uint8Array(160);
    wallets.set(this.internalUid, 0);
    if (this.safeCardInserted) wallets.set(this.externalUid, 71);
    const secret = latticeSharedSecret(this.ephPriv, this.appPub);
    return concat([head, await latticeAesEncrypt(wallets, secret)]);
  }

  private async handleEncrypted(data: Uint8Array): Promise<Uint8Array> {
    if (!this.appPub) return this.errorPayload(LatticeResponseCode.INVALID_EPHEM_ID);
    const secret = latticeSharedSecret(this.ephPriv, this.appPub);
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
    else result = this.handleSign(request);
    if (typeof result === "number") return this.errorPayload(result);

    // Encrypt [newEphPub][data][crc BE] with the request's secret, then rotate.
    const nextPriv = p256.utils.randomPrivateKey();
    const out = new Uint8Array(1728);
    out.set(p256.getPublicKey(nextPriv, false), 0);
    out.set(result.subarray(0, RESPONSE_SIZES[requestType]), 65);
    const checksumOff = 65 + RESPONSE_SIZES[requestType];
    writeU32BE(out, checksumOff, crc32Lattice(out.subarray(0, checksumOff)));
    const cipher = await latticeAesEncrypt(out, secret);
    this.ephPriv = nextPriv;
    return concat([Uint8Array.from([0]), cipher, new Uint8Array(1728)]);
  }

  private handlePair(request: Uint8Array): Uint8Array | number {
    const nameBuf = request.subarray(0, 25);
    const der = request.subarray(25, 99);
    const trimmed = der.subarray(0, 2 + der[1]);
    const digest = sha256(concat([this.appPub as Uint8Array, nameBuf, toBytes(this.pairingCode)]), "bytes");
    const ok = p256.verify(trimmed, digest, this.appPub as Uint8Array, { prehash: false, lowS: false });
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

  private handleSign(request: Uint8Array): Uint8Array | number {
    const hasExtra = request[0] === 1;
    const schema = request[1];
    const uid = request.subarray(2, 34);
    if (!uid.every((b, i) => b === this.activeUid[i])) return LatticeResponseCode.WRONG_WALLET;
    const reqPayload = request.subarray(34);

    if (schema === LatticeSignSchema.GENERIC) {
      const head = reqPayload.slice(0, LATTICE_FW_DEFAULT.gsBaseReqSz);
      if (!hasExtra) return this.sign(head, [], 0);
      this.pendingSign = { head, collected: [], nextCode: crypto.getRandomValues(new Uint8Array(8)), extraFrames: 0 };
      const resp = new Uint8Array(1090);
      resp.set(this.pendingSign.nextCode);
      return resp;
    }
    if (schema === LatticeSignSchema.EXTRA_DATA) {
      const pending = this.pendingSign;
      if (!pending) return LatticeResponseCode.INVALID_MSG;
      if (!reqPayload.subarray(0, 8).every((b, i) => b === pending.nextCode[i])) return LatticeResponseCode.INVALID_MSG;
      const len = u32le(reqPayload, 8);
      pending.collected.push(reqPayload.slice(12, 12 + len));
      pending.extraFrames += 1;
      if (hasExtra) {
        pending.nextCode = crypto.getRandomValues(new Uint8Array(8));
        const resp = new Uint8Array(1090);
        resp.set(pending.nextCode);
        return resp;
      }
      this.pendingSign = null;
      return this.sign(pending.head, pending.collected, pending.extraFrames);
    }
    return LatticeResponseCode.INVALID_MSG;
  }

  private sign(head: Uint8Array, extras: Uint8Array[], extraFrames: number): Uint8Array {
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
    this.signRecords.push({ signerPath, encoding, hashType, payloadDataSz, message, digest, decoder, extraFrames });

    const key = this.keyFor(signerPath);
    const sig = secp256k1.sign(digest, key);
    const resp = new Uint8Array(1090);
    resp.set(secp256k1.getPublicKey(key, false), 0);
    resp.set(sig.toDERRawBytes(), 65);
    if (!this.omitDigest) resp.set(this.forgedDigest ?? digest, 65 + 74);
    return resp;
  }
}
