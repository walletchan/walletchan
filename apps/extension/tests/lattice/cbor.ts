/** Minimal CBOR decoder for the simulator: the subset ETH_MSG typed-data requests use. */
import { bytesToHex } from "viem";

export function decodeCbor(bytes: Uint8Array): unknown {
  let off = 0;
  const length = (info: number): number => {
    if (info < 24) return info;
    const size = { 24: 1, 25: 2, 26: 4 }[info];
    if (!size) throw new Error(`Unsupported CBOR length encoding ${info}`);
    let value = 0;
    for (let i = 0; i < size; i += 1) value = value * 256 + bytes[off + i];
    off += size;
    return value;
  };
  const item = (): unknown => {
    if (off >= bytes.length) throw new Error("Truncated CBOR");
    const initial = bytes[off];
    off += 1;
    const major = initial >> 5;
    const info = initial & 0x1f;
    if (major === 6) {
      if (info !== 2 && info !== 3) throw new Error(`Unsupported CBOR tag ${info}`);
      const magnitude = item() as Uint8Array;
      const n = magnitude.length === 0 ? 0n : BigInt(bytesToHex(magnitude));
      return info === 2 ? n : -1n - n;
    }
    const n = length(info);
    if (major === 0) return n;
    if (major === 1) return -1 - n;
    if (major === 2 || major === 3) {
      const slice = bytes.slice(off, off + n);
      off += n;
      return major === 2 ? slice : new TextDecoder().decode(slice);
    }
    if (major === 4) return Array.from({ length: n }, () => item());
    if (major === 5) {
      const out: Record<string, unknown> = {};
      for (let i = 0; i < n; i += 1) {
        const key = item() as string;
        out[key] = item();
      }
      return out;
    }
    throw new Error(`Unsupported CBOR major type ${major}`);
  };
  const value = item();
  if (off !== bytes.length) throw new Error("Trailing CBOR bytes");
  return value;
}
