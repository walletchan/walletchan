/** Small byte helpers for the Lattice wire format. */
import { concat } from "viem";

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  return concat(parts);
}

function view(buf: Uint8Array): DataView {
  return new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
}

export function writeU32LE(buf: Uint8Array, off: number, value: number): void {
  view(buf).setUint32(off, value >>> 0, true);
}

export function writeU32BE(buf: Uint8Array, off: number, value: number): void {
  view(buf).setUint32(off, value >>> 0, false);
}

export function writeU16LE(buf: Uint8Array, off: number, value: number): void {
  view(buf).setUint16(off, value, true);
}

export function writeU16BE(buf: Uint8Array, off: number, value: number): void {
  view(buf).setUint16(off, value, false);
}

export function readU32BE(buf: Uint8Array, off: number): number {
  return view(buf).getUint32(off, false);
}

export function readU16BE(buf: Uint8Array, off: number): number {
  return view(buf).getUint16(off, false);
}

export function u32LE(value: number): Uint8Array {
  const out = new Uint8Array(4);
  writeU32LE(out, 0, value);
  return out;
}

export function isAllZero(buf: Uint8Array): boolean {
  return buf.every((byte) => byte === 0);
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Left-pad with zeros or keep the trailing `length` bytes. */
export function fixLength(buf: Uint8Array, length: number): Uint8Array {
  if (buf.length === length) return buf;
  if (buf.length < length) return concatBytes(new Uint8Array(length - buf.length), buf);
  return buf.slice(buf.length - length);
}

export { bytesToBigInt } from "viem";
