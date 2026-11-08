/**
 * Lattice signature replies: DER parsing, the generic-signing and ETH_MSG
 * response layouts, and secp256k1 y-parity recovery against the device key.
 *
 * Ported from ape-grid-lattice `ape_grid/protocol/encoding.py`, which mirrors
 * gridplus-sdk `util.ts` (`parseDER`) and `genericSigning.ts`.
 */
import { bytesToHex, hexToBytes, recoverPublicKey, type Hex } from "viem";

import { concatBytes, equalBytes, fixLength, isAllZero } from "./bytes";

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

/** SEC1 compressed form (0x02/0x03 || X) of a 65-byte uncompressed public key. */
function compressPublicKey(uncompressed: Uint8Array): Uint8Array {
  return concatBytes(Uint8Array.of(uncompressed[64] & 1 ? 0x03 : 0x02), uncompressed.subarray(1, 33));
}

/**
 * Recovery id (0 or 1) whose public key matches the device-returned key (33 or
 * 65 bytes), with that key uncompressed.
 */
export async function recoverLatticeSigner(
  msgHash: Uint8Array,
  r: Uint8Array,
  s: Uint8Array,
  expectedPubkey: Uint8Array,
): Promise<{ yParity: 0 | 1; publicKey: Hex }> {
  for (const yParity of [0, 1] as const) {
    let publicKey: Hex;
    try {
      publicKey = await recoverPublicKey({ hash: msgHash, signature: { r: bytesToHex(r), s: bytesToHex(s), yParity } });
    } catch {
      continue; // try the other recovery id
    }
    const recovered = hexToBytes(publicKey);
    if (equalBytes(expectedPubkey.length === 33 ? compressPublicKey(recovered) : recovered, expectedPubkey)) {
      return { yParity, publicKey };
    }
  }
  throw new Error("Failed to recover Lattice signature y-parity");
}
