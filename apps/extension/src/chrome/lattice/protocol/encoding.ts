/**
 * Lattice frame encoding, encrypted payloads and generic signing requests.
 *
 * Ported from ape-grid-lattice `ape_grid/protocol/encoding.py`, which mirrors
 * gridplus-sdk `protocol/secureMessages.ts`, `util.ts`,
 * `functions/getAddresses.ts`, `functions/sign.ts` and `genericSigning.ts`.
 * The ETH_MSG personal-sign request follows gridplus-sdk 4.0.0 `ethereum.ts`.
 */
import { secp256k1 } from "@noble/curves/secp256k1";
import { hashMessage, keccak256, sha256 } from "viem";

import {
  bytesToBigInt,
  concatBytes,
  equalBytes,
  fixLength,
  isAllZero,
  readU16BE,
  readU32BE,
  u32LE,
  writeU16BE,
  writeU16LE,
  writeU32BE,
  writeU32LE,
} from "./bytes";
import {
  LATTICE_ADDR_STR_LEN,
  LATTICE_CHECKSUM_SIZE,
  LATTICE_DATA_REQ_CONNECT,
  LATTICE_DATA_REQ_ENCRYPTED,
  LATTICE_EPHEMERAL_PUB_SIZE,
  LATTICE_HEADER_SIZE,
  LATTICE_MSG_ID_LEN,
  LATTICE_PAYLOAD_REQ_CONNECT,
  LATTICE_PAYLOAD_REQ_ENCRYPTED,
  LATTICE_PROTOCOL_VERSION_V1,
  LATTICE_REQUEST_DATA_SIZES,
  LATTICE_RESPONSE_DATA_SIZES,
  LATTICE_WALLET_UID_LEN,
  LatticeGetAddressesFlag,
  LatticeMsgType,
  LatticeResponseCode,
  LatticeSecureMsgType,
  LatticeSignHash,
  type LatticeEncryptedRequestType,
  type LatticeSignCurve,
  type LatticeSignEncoding,
} from "./constants";
import { crc32 } from "./crc32";
import { gsMaxExpandedSize, LATTICE_FW_DEFAULT, type LatticeFirmwareConstants } from "./firmware";
import { latticeAesDecrypt, latticeAesEncrypt, latticeEphemeralId } from "./secureChannel";

// ---------- outer request frame ----------

function packOuter(secureMsgType: LatticeSecureMsgType, msgId: Uint8Array, payloadData: Uint8Array): Uint8Array {
  if (msgId.length !== LATTICE_MSG_ID_LEN) throw new Error("msgId must be 4 bytes");
  const payloadLen =
    secureMsgType === LatticeSecureMsgType.CONNECT ? LATTICE_PAYLOAD_REQ_CONNECT : LATTICE_PAYLOAD_REQ_ENCRYPTED;
  if (payloadData.length !== payloadLen - 1) {
    throw new Error(`secure payload must be ${payloadLen - 1} bytes`);
  }
  const body = new Uint8Array(LATTICE_HEADER_SIZE + payloadLen);
  body[0] = LATTICE_PROTOCOL_VERSION_V1;
  body[1] = LatticeMsgType.SECURE;
  body.set(msgId, 2);
  writeU16BE(body, 6, payloadLen);
  body[8] = secureMsgType;
  body.set(payloadData, 9);
  const checksum = new Uint8Array(LATTICE_CHECKSUM_SIZE);
  writeU32BE(checksum, 0, crc32(body));
  return concatBytes(body, checksum);
}

export function buildConnectRequest(appPubUncompressed: Uint8Array, msgId: Uint8Array): Uint8Array {
  if (appPubUncompressed.length !== LATTICE_EPHEMERAL_PUB_SIZE) {
    throw new Error("app public key must be 65 bytes uncompressed");
  }
  const data = new Uint8Array(LATTICE_DATA_REQ_CONNECT);
  data.set(appPubUncompressed);
  return packOuter(LatticeSecureMsgType.CONNECT, msgId, data);
}

export async function buildEncryptedRequest(
  requestType: LatticeEncryptedRequestType,
  requestData: Uint8Array,
  sharedSecret: Uint8Array,
  msgId: Uint8Array,
): Promise<Uint8Array> {
  const expected = LATTICE_REQUEST_DATA_SIZES[requestType];
  if (requestData.length !== expected) {
    throw new Error(`request data must be ${expected} bytes for type ${requestType}`);
  }
  // Plaintext: [requestType(1)][data][crc32(4 LE)], zero-filled to 1728 bytes.
  const plain = new Uint8Array(LATTICE_DATA_REQ_ENCRYPTED);
  plain[0] = requestType;
  plain.set(requestData, 1);
  writeU32LE(plain, 1 + expected, crc32(plain.subarray(0, 1 + expected)));

  const payload = new Uint8Array(LATTICE_PAYLOAD_REQ_ENCRYPTED - 1);
  writeU32LE(payload, 0, latticeEphemeralId(sharedSecret));
  payload.set(await latticeAesEncrypt(plain, sharedSecret), 4);
  return packOuter(LatticeSecureMsgType.ENCRYPTED, msgId, payload);
}

// ---------- outer response frame ----------

export interface ParsedLatticeResponse {
  data: Uint8Array;
  responseCode: number;
}

export function parseLatticeResponse(frame: Uint8Array): ParsedLatticeResponse {
  if (frame.length < LATTICE_HEADER_SIZE + 1 + LATTICE_CHECKSUM_SIZE) {
    throw new Error("Lattice response too short");
  }
  if (frame[0] !== LATTICE_PROTOCOL_VERSION_V1) throw new Error("Incorrect Lattice protocol version");
  if (frame[1] !== LatticeMsgType.RESPONSE) throw new Error("Incorrect Lattice response type");
  const payloadLen = readU16BE(frame, 6);
  const off = LATTICE_HEADER_SIZE + payloadLen;
  if (payloadLen < 1 || frame.length < off + LATTICE_CHECKSUM_SIZE) {
    throw new Error("Lattice response length mismatch");
  }
  const got = readU32BE(frame, off);
  const want = crc32(frame.subarray(0, frame.length - LATTICE_CHECKSUM_SIZE));
  if (got !== want) throw new Error("Bad Lattice response checksum");

  const payload = frame.subarray(LATTICE_HEADER_SIZE, off);
  const responseCode = payload[0];
  if (responseCode !== LatticeResponseCode.SUCCESS) {
    return { data: new Uint8Array(0), responseCode };
  }
  return { data: payload.slice(1), responseCode };
}

export interface DecryptedLatticeResponse {
  newEphemeralPub: Uint8Array;
  data: Uint8Array;
}

export async function decryptLatticeResponse(
  encryptedPayload: Uint8Array,
  requestType: LatticeEncryptedRequestType,
  sharedSecret: Uint8Array,
): Promise<DecryptedLatticeResponse> {
  if (encryptedPayload.length < LATTICE_DATA_REQ_ENCRYPTED) {
    throw new Error("Encrypted Lattice response too short");
  }
  const plain = await latticeAesDecrypt(encryptedPayload.subarray(0, LATTICE_DATA_REQ_ENCRYPTED), sharedSecret);
  const dataSz = LATTICE_RESPONSE_DATA_SIZES[requestType];
  const checksumOff = LATTICE_EPHEMERAL_PUB_SIZE + dataSz;
  const got = readU32BE(plain, checksumOff);
  if (got !== crc32(plain.subarray(0, checksumOff))) {
    throw new Error("Decrypted Lattice response checksum mismatch");
  }
  return {
    newEphemeralPub: plain.slice(0, LATTICE_EPHEMERAL_PUB_SIZE),
    data: plain.slice(LATTICE_EPHEMERAL_PUB_SIZE, checksumOff),
  };
}

// ---------- getAddresses ----------

export function encodeGetAddressesRequest(input: {
  walletUid: Uint8Array;
  startPath: readonly number[];
  n: number;
  flag?: number;
  iterIdx?: number;
}): Uint8Array {
  const { walletUid, startPath, n } = input;
  const flag = input.flag ?? LatticeGetAddressesFlag.NONE;
  const iterIdx = input.iterIdx ?? 0;
  const nibble = (value: number) => Number.isInteger(value) && value >= 0 && value <= 0x0f;
  if (
    walletUid.length !== LATTICE_WALLET_UID_LEN || startPath.length < 2 || startPath.length > 5 ||
    !nibble(n) || !nibble(flag) || !Number.isInteger(iterIdx) || iterIdx < 0 || iterIdx > startPath.length
  ) {
    throw new Error("Invalid getAddresses request");
  }

  const buf = new Uint8Array(54);
  buf.set(walletUid);
  buf[32] = ((iterIdx & 0x0f) << 4) | (startPath.length & 0x0f);
  for (let i = 0; i < 5; i += 1) writeU32BE(buf, 33 + 4 * i, startPath[i] ?? 0);
  buf[53] = ((flag & 0x0f) << 4) | (n & 0x0f);
  return buf;
}

/** Address strings from a flag-0 getAddresses response. */
export function decodeGetAddressesResponse(data: Uint8Array): string[] {
  const respLen = Math.min(data.length, LATTICE_RESPONSE_DATA_SIZES[1]);
  const out: string[] = [];
  const decoder = new TextDecoder("utf-8", { fatal: false });
  for (let off = 0; off < respLen; off += LATTICE_ADDR_STR_LEN) {
    const chunk = data.subarray(off, off + LATTICE_ADDR_STR_LEN);
    const nul = chunk.indexOf(0);
    if (nul <= 0) continue;
    const text = Array.from(decoder.decode(chunk.subarray(0, nul)))
      .filter((ch) => ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) < 0x7f)
      .join("");
    if (text) out.push(text);
  }
  return out;
}

// ---------- sign envelope ----------

/** 1680-byte buffer: hasExtra(1) | schema(1) | walletUID(32) | reqPayload | zero-pad. */
export function encodeSignEnvelope(input: {
  schema: number;
  walletUid: Uint8Array;
  reqPayload: Uint8Array;
  hasExtraPayloads?: boolean;
  reqMaxDataSz?: number;
}): Uint8Array {
  if (input.walletUid.length !== LATTICE_WALLET_UID_LEN) throw new Error("walletUID must be 32 bytes");
  const total = 2 + (input.reqMaxDataSz ?? LATTICE_FW_DEFAULT.reqMaxDataSz);
  if (2 + LATTICE_WALLET_UID_LEN + input.reqPayload.length > total) {
    throw new Error("Request payload too large for sign envelope");
  }
  const buf = new Uint8Array(total);
  buf[0] = input.hasExtraPayloads ? 1 : 0;
  buf[1] = input.schema & 0xff;
  buf.set(input.walletUid, 2);
  buf.set(input.reqPayload, 34);
  return buf;
}

// ---------- generic signing request ----------

/** 24 bytes: pathLen(u32 LE) | 5 * u32 LE. */
export function buildSignerPathBuf(signerPath: readonly number[], varAddrPathSzAllowed = true): Uint8Array {
  if (varAddrPathSzAllowed && signerPath.length > 5) throw new Error("Signer path must be <=5 indices");
  if (!varAddrPathSzAllowed && signerPath.length !== 5) {
    throw new Error("Signer path must be exactly 5 indices on this firmware");
  }
  const buf = new Uint8Array(24);
  writeU32LE(buf, 0, signerPath.length);
  for (let i = 0; i < 5; i += 1) writeU32LE(buf, 4 + 4 * i, signerPath[i] ?? 0);
  return buf;
}

export interface GenericSigningRequest {
  /** `gsBaseReqSz` bytes; goes into a GENERIC sign envelope. */
  base: Uint8Array;
  /** `[length(4 LE) | frame]` follow-ups for EXTRA_DATA envelopes. */
  extraPayloads: Uint8Array[];
  /** True when the payload exceeded the firmware limit and the device signs its hash. */
  prehashed: boolean;
  /** True when a calldata decoder block was attached. */
  decoderAttached: boolean;
}

/**
 * Layout: encoding(4 LE) | hashType(1) | curve(1) | signerPath(24)
 *         | omitPubkey(1) | payloadDataSz(2 LE) | payloadBytes | zero-pad
 */
export function encodeGenericSigningRequest(input: {
  signerPath: readonly number[];
  payload: Uint8Array;
  curve: LatticeSignCurve;
  hashType: LatticeSignHash;
  encoding: LatticeSignEncoding;
  omitPubkey?: boolean;
  fw?: LatticeFirmwareConstants;
  decoder?: Uint8Array;
}): GenericSigningRequest {
  const fw = input.fw ?? LATTICE_FW_DEFAULT;
  const { payload, hashType } = input;
  const maxExpanded = gsMaxExpandedSize(fw);
  if (payload.length === 0) throw new Error("Payload cannot be empty");
  if (payload.length > 0xffff) throw new Error("Payload too large");

  let dataToCopy = payload;
  let decoderAttached = false;
  let prehashed = false;
  const extraPayloads: Uint8Array[] = [];

  if (input.decoder && input.decoder.length > 0) {
    if (input.decoder.length > fw.decoderMaxSz) {
      throw new Error(`Decoder too large: ${input.decoder.length} > ${fw.decoderMaxSz}`);
    }
    if (payload.length + 8 + input.decoder.length <= maxExpanded) {
      dataToCopy = concatBytes(payload, u32LE(fw.decoderReserved), u32LE(input.decoder.length), input.decoder);
      decoderAttached = true;
    }
  }

  if (dataToCopy.length > fw.gsBaseDataSz) {
    if (fw.prehashAllowed && payload.length > maxExpanded) {
      prehashed = true;
      decoderAttached = false;
      if (hashType === LatticeSignHash.KECCAK256) dataToCopy = keccak256(payload, "bytes");
      else if (hashType === LatticeSignHash.SHA256) dataToCopy = sha256(payload, "bytes");
      else throw new Error("Message too large to send and hashType=NONE");
    } else {
      const full = dataToCopy;
      dataToCopy = full.subarray(0, fw.gsBaseDataSz);
      extraPayloads.push(...extraDataFrames(full.subarray(fw.gsBaseDataSz), fw.extraDataFrameSz));
    }
  }

  const base = new Uint8Array(fw.gsBaseReqSz);
  writeU32LE(base, 0, input.encoding);
  base[4] = hashType;
  base[5] = input.curve;
  base.set(buildSignerPathBuf(input.signerPath, fw.varAddrPathSzAllowed), 6);
  base[30] = input.omitPubkey ? 1 : 0;
  writeU16LE(base, 31, payload.length);
  base.set(dataToCopy, 33);
  return { base, extraPayloads, prehashed, decoderAttached };
}

/** `[length(4 LE) | frame]` chunks for EXTRA_DATA envelopes. */
function extraDataFrames(overflow: Uint8Array, frameSz: number): Uint8Array[] {
  const frames: Uint8Array[] = [];
  for (let i = 0; i < overflow.length; i += frameSz) {
    const frame = overflow.subarray(i, i + frameSz);
    frames.push(concatBytes(u32LE(frame.length), frame));
  }
  return frames;
}

// ---------- ETH_MSG personal sign ----------

export interface PersonalSignRequest {
  /** Goes into an ETH_MSG sign envelope. */
  base: Uint8Array;
  extraPayloads: Uint8Array[];
  /** True when the message exceeded the firmware limit and the device signs its digest. */
  prehashed: boolean;
  /** True when the device shows hex because the message is not ASCII. */
  displayHex: boolean;
}

/**
 * gridplus-sdk `buildPersonalSignRequest`. The device adds the EIP-191 prefix
 * and shows ASCII messages as text.
 * Layout: protocol(1)=0 | signerPath(24) | displayHex(1) | msgLen(2 LE)
 *         | message, or keccak256(EIP-191 preimage) when prehashed
 */
export function encodePersonalSignRequest(input: {
  signerPath: readonly number[];
  message: Uint8Array;
  fw?: LatticeFirmwareConstants;
}): PersonalSignRequest {
  const fw = input.fw ?? LATTICE_FW_DEFAULT;
  const { message } = input;
  if (message.length > 0xffff) throw new Error("Message too large");
  // The SDK tests the decoded string against /^[\x00-\x7F]+$/, so empty shows hex too.
  const displayHex = message.length === 0 || message.some((byte) => byte > 0x7f);
  const maxFull = fw.ethMsgMaxBaseSz + fw.extraDataMaxFrames * fw.extraDataFrameSz - fw.personalSignHeaderSz;
  const prehashed = message.length > maxFull;
  const body = prehashed ? hashMessage({ raw: message }, "bytes") : message.subarray(0, fw.ethMsgMaxBaseSz);
  const base = new Uint8Array(28 + body.length);
  base.set(buildSignerPathBuf(input.signerPath, fw.varAddrPathSzAllowed), 1);
  base[25] = displayHex ? 1 : 0;
  writeU16LE(base, 26, message.length);
  base.set(body, 28);
  const extraPayloads = prehashed ? [] : extraDataFrames(message.subarray(fw.ethMsgMaxBaseSz), fw.extraDataFrameSz);
  return { base, extraPayloads, prehashed, displayHex };
}

/** ETH_MSG reply: DER signature (74-byte slot) | signer address(20). */
export function parseEthMsgSignResponse(data: Uint8Array): { r: Uint8Array; s: Uint8Array; signer: Uint8Array } {
  const { r, s } = parseDerSignature(data.subarray(0, 2 + data[1]));
  return { r: fixLength(r, 32), s: fixLength(s, 32), signer: data.slice(74, 94) };
}

// ---------- signature response ----------

/** Minimal DER (r, s) parser, matching gridplus-sdk `parseDER`. */
export function parseDerSignature(der: Uint8Array): { r: Uint8Array; s: Uint8Array } {
  if (der.length < 8 || der[0] !== 0x30 || der[2] !== 0x02) throw new Error("Invalid DER signature");
  let off = 3;
  const rLen = der[off];
  off += 1;
  const r = der.slice(off, off + rLen);
  off += rLen;
  if (der[off] !== 0x02) throw new Error("Invalid DER signature");
  off += 1;
  const sLen = der[off];
  off += 1;
  const s = der.slice(off, off + sLen);
  if (r.length !== rLen || s.length !== sLen) throw new Error("Truncated DER signature");
  return { r, s };
}

export interface LatticeSecpSignResponse {
  /** 33 or 65 bytes, or empty when omitted. */
  pubkey: Uint8Array;
  r: Uint8Array;
  s: Uint8Array;
  /** Device-reported digest, or empty when the firmware omits it. */
  digest: Uint8Array;
}

export function parseGenericSigningResponseSecp256k1(data: Uint8Array, omitPubkey = false): LatticeSecpSignResponse {
  let off = 0;
  let pubkey: Uint8Array = new Uint8Array(0);
  if (!omitPubkey) {
    const compression = data[off];
    off += 1;
    if (compression === 0x02 || compression === 0x03) pubkey = data.slice(0, 33);
    else if (compression === 0x04) pubkey = data.slice(0, 65);
    else throw new Error(`Bad Lattice pubkey compression byte: ${compression}`);
    off += 64;
  } else {
    off += 65;
  }
  const sigLen = 2 + data[off + 1];
  const { r, s } = parseDerSignature(data.subarray(off, off + sigLen));
  off += 74;
  let digest: Uint8Array = new Uint8Array(0);
  if (data.length >= off + 32) {
    const candidate = data.slice(off, off + 32);
    if (!isAllZero(candidate)) digest = candidate;
  }
  return { pubkey, r: fixLength(r, 32), s: fixLength(s, 32), digest };
}

/** Recovery id (0 or 1) whose public key matches the device-returned key. */
export function recoverYParity(msgHash: Uint8Array, r: Uint8Array, s: Uint8Array, expectedPubkey: Uint8Array): 0 | 1 {
  const expected = secp256k1.ProjectivePoint.fromHex(expectedPubkey).toRawBytes(false);
  const signature = new secp256k1.Signature(bytesToBigInt(r), bytesToBigInt(s));
  for (const v of [0, 1] as const) {
    try {
      const recovered = signature.addRecoveryBit(v).recoverPublicKey(msgHash).toRawBytes(false);
      if (equalBytes(recovered, expected)) return v;
    } catch {
      // try the other recovery id
    }
  }
  throw new Error("Failed to recover Lattice signature y-parity");
}

export function newLatticeMsgId(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(LATTICE_MSG_ID_LEN));
}
