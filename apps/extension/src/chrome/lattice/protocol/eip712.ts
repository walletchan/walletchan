/**
 * ETH_MSG typed-data request: the Lattice shows EIP-712 fields.
 *
 * Ported from gridplus-sdk 4.0.0 `buildEIP712Request`, `parseEIP712Msg` and
 * `parseEIP712Item`, with node-cbor's default encoder as the SDK uses it:
 * maps keep insertion order, every integer is a tag 2/3 bignum, address and
 * bytes values are byte strings, and bools are 1/0. Byte parity with the real
 * SDK: tests/lattice/sdkParity.test.ts.
 *
 * Returns null when the device cannot show the data as fields (a type or
 * shape the firmware lacks, more than 36 fields in one type, or a payload
 * above the frame limit). Callers then sign the EIP-712 hashes instead.
 * One deliberate difference: the SDK sends a dynamic `bytes` value of 0x00
 * as empty bytes; this sends the real byte, so the device signs the data the
 * dapp asked for.
 */
import { getTypesForEIP712Domain, hexToBytes } from "viem";

import { concatBytes, u32LE, writeU16LE } from "./bytes";
import { buildSignerPathBuf } from "./encoding";
import { LATTICE_FW_DEFAULT, type LatticeFirmwareConstants } from "./firmware";

interface TypedField {
  name: string;
  type: string;
}
type TypedFields = Record<string, TypedField[]>;

/** gridplus-sdk `eip712MaxTypeParams` for firmware >= 0.14.0. */
const MAX_TYPE_PARAMS = 36;
const ETH_MSG_TYPED_DATA = 1;

const WIDTHS = Array.from({ length: 32 }, (_, i) => 8 * (i + 1));
/** EIP712_ABI_LATTICE_FW_TYPE_MAP, minus the unsized `uint` alias EIP-712 does not define. */
const ATOMIC_TYPES = new Set([
  "address",
  "bool",
  "string",
  "bytes",
  ...WIDTHS.map((w) => `uint${w}`),
  ...WIDTHS.map((w) => `int${w}`),
  ...Array.from({ length: 32 }, (_, i) => `bytes${i + 1}`),
]);

class UnsupportedTypedData extends Error {}

export interface TypedDataRequest {
  /** Goes into an ETH_MSG sign envelope. */
  base: Uint8Array;
  extraPayloads: Uint8Array[];
}

export function encodeTypedDataRequest(input: {
  signerPath: readonly number[];
  typedData: Record<string, unknown>;
  fw?: LatticeFirmwareConstants;
}): TypedDataRequest | null {
  const fw = input.fw ?? LATTICE_FW_DEFAULT;
  let payload: Uint8Array;
  try {
    payload = cbor(deviceTypedData(input.typedData));
  } catch (error) {
    if (error instanceof UnsupportedTypedData) return null;
    throw error;
  }
  if (payload.length > fw.ethMsgMaxBaseSz + fw.extraDataMaxFrames * fw.extraDataFrameSz) return null;
  // The SDK copies one byte past the base frame's 1,540 into the base request
  // (its buffer holds 1,541); the extra frames still start at byte 1,540.
  const body = payload.subarray(0, fw.ethMsgMaxBaseSz + 1);
  const base = new Uint8Array(27 + body.length);
  base[0] = ETH_MSG_TYPED_DATA;
  base.set(buildSignerPathBuf(input.signerPath, fw.varAddrPathSzAllowed), 1);
  writeU16LE(base, 25, payload.length);
  base.set(body, 27);
  const extraPayloads: Uint8Array[] = [];
  const overflow = payload.subarray(fw.ethMsgMaxBaseSz);
  for (let i = 0; i < overflow.length; i += fw.extraDataFrameSz) {
    const frame = overflow.subarray(i, i + fw.extraDataFrameSz);
    extraPayloads.push(concatBytes(u32LE(frame.length), frame));
  }
  return { base, extraPayloads };
}

/** `{ types, primaryType, domain, message }` in the input's key order, values as the device expects. */
function deviceTypedData(typedData: Record<string, unknown>): Record<string, unknown> {
  const { primaryType, domain, message } = typedData;
  const given = typedData.types;
  if (typeof primaryType !== "string" || !isRecord(given) || !isRecord(domain) || !isRecord(message)) {
    throw new UnsupportedTypedData();
  }
  const types: TypedFields = {};
  if (!("EIP712Domain" in given)) types.EIP712Domain = getTypesForEIP712Domain({ domain: domain as never });
  for (const [name, fields] of Object.entries(given)) {
    if (!Array.isArray(fields)) throw new UnsupportedTypedData();
    types[name] = fields.map((field: unknown) => {
      if (!isRecord(field) || typeof field.name !== "string" || typeof field.type !== "string") {
        throw new UnsupportedTypedData();
      }
      return { name: field.name, type: field.type };
    });
  }
  if (!types[primaryType]) throw new UnsupportedTypedData();
  for (const fields of Object.values(types)) {
    if (fields.length > MAX_TYPE_PARAMS) throw new UnsupportedTypedData();
    for (const field of fields) checkType(field.type, types);
  }
  const converted: Record<string, unknown> = {
    types,
    primaryType,
    domain: convertStruct(domain, "EIP712Domain", types),
    message: convertStruct(message, primaryType, types),
  };
  const order = Object.keys(typedData).filter((key) => key in converted);
  return Object.fromEntries([...order, ...Object.keys(converted).filter((key) => !order.includes(key))].map((key) => [key, converted[key]]));
}

function checkType(type: string, types: TypedFields): void {
  const inner = type.endsWith("]") ? type.slice(0, type.lastIndexOf("[")) : type;
  if (inner.includes("[")) throw new UnsupportedTypedData();
  if (!types[inner] && !ATOMIC_TYPES.has(inner)) throw new UnsupportedTypedData();
}

/** Typed fields only, in the value's own key order (as the SDK's in-place parse leaves them). */
function convertStruct(value: unknown, typeName: string, types: TypedFields): Record<string, unknown> {
  if (!isRecord(value)) throw new UnsupportedTypedData();
  const fields = new Map(types[typeName].map((field) => [field.name, field.type]));
  if ([...fields.keys()].some((name) => !(name in value))) throw new UnsupportedTypedData();
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    const type = fields.get(key);
    if (type !== undefined) out[key] = convertValue(value[key], type, types);
  }
  return out;
}

function convertValue(value: unknown, type: string, types: TypedFields): unknown {
  if (type.endsWith("]")) {
    const open = type.lastIndexOf("[");
    const length = type.slice(open + 1, -1);
    if (!Array.isArray(value) || (length !== "" && value.length !== Number(length))) throw new UnsupportedTypedData();
    return value.map((item) => convertValue(item, type.slice(0, open), types));
  }
  if (types[type]) return convertStruct(value, type, types);
  if (type === "string") {
    if (typeof value !== "string") throw new UnsupportedTypedData();
    return value;
  }
  if (type === "bool") {
    if (typeof value !== "boolean") throw new UnsupportedTypedData();
    return value ? 1 : 0;
  }
  if (type === "bytes") return bytesOf(value);
  if (type === "address" || type.startsWith("bytes")) {
    const size = type === "address" ? 20 : Number(type.slice(5));
    const bytes = bytesOf(value);
    if (bytes.length === 0 || bytes.every((byte) => byte === 0)) return new Uint8Array(size);
    if (bytes.length !== size) throw new UnsupportedTypedData();
    return bytes;
  }
  const integer = integerOf(value);
  if (type.startsWith("uint") && integer < 0n) throw new UnsupportedTypedData();
  return integer;
}

function bytesOf(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]*$/.test(value)) throw new UnsupportedTypedData();
  const digits = value.length % 2 === 0 ? value.slice(2) : `0${value.slice(2)}`;
  return hexToBytes(`0x${digits}`);
}

function integerOf(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string") {
    if (/^-?\d+$/.test(value)) return BigInt(value);
    if (/^0x[0-9a-fA-F]+$/.test(value)) return BigInt(value);
  }
  throw new UnsupportedTypedData();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Uint8Array);
}

// ---------- CBOR (RFC 8949), the subset node-cbor emits for this data ----------

function cbor(value: unknown): Uint8Array {
  const out: number[] = [];
  write(value, out);
  return Uint8Array.from(out);
}

function head(major: number, length: number, out: number[]): void {
  const m = major << 5;
  if (length < 24) out.push(m | length);
  else if (length < 0x100) out.push(m | 24, length);
  else if (length < 0x10000) out.push(m | 25, length >> 8, length & 0xff);
  else out.push(m | 26, (length >>> 24) & 0xff, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff);
}

function write(value: unknown, out: number[]): void {
  if (typeof value === "string") {
    const bytes = new TextEncoder().encode(value);
    head(3, bytes.length, out);
    out.push(...bytes);
  } else if (value instanceof Uint8Array) {
    head(2, value.length, out);
    out.push(...value);
  } else if (typeof value === "bigint") {
    // node-cbor `_pushJSBigint`: tag 2 with the magnitude, or tag 3 with -1 - n.
    const magnitude = value < 0n ? -value - 1n : value;
    const digits = magnitude.toString(16);
    out.push(value < 0n ? 0xc3 : 0xc2);
    write(hexToBytes(`0x${digits.length % 2 ? `0${digits}` : digits}`), out);
  } else if (typeof value === "number") {
    if (value >= 0) head(0, value, out);
    else head(1, -1 - value, out);
  } else if (Array.isArray(value)) {
    head(4, value.length, out);
    for (const item of value) write(item, out);
  } else if (isRecord(value)) {
    const entries = Object.entries(value);
    head(5, entries.length, out);
    for (const [key, item] of entries) {
      write(key, out);
      write(item, out);
    }
  } else {
    throw new UnsupportedTypedData();
  }
}
