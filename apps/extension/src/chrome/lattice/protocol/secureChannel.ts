/**
 * P-256 keys, ECDH and AES-256-CBC with the Lattice static IV.
 *
 * Ported from ape-grid-lattice `ape_grid/protocol/secure_channel.py`, which
 * mirrors gridplus-sdk `util.ts` and `shared/utilities.ts`.
 */
import { p256 } from "@noble/curves/p256";
import { sha256 } from "viem";

import { readU32BE } from "./bytes";
import { LATTICE_AES_IV, LATTICE_DER_SIG_PADDED_SIZE } from "./constants";

export function generateLatticeAppPrivateKey(): Uint8Array {
  return p256.utils.randomPrivateKey();
}

export function assertLatticeAppPrivateKey(priv: Uint8Array): void {
  if (priv.length !== 32 || !p256.utils.isValidPrivateKey(priv)) {
    throw new Error("Lattice app key must be a valid 32-byte P-256 private key.");
  }
}

/** 65-byte uncompressed SEC1 point (0x04 || X || Y). */
export function latticeAppPublicKey(priv: Uint8Array): Uint8Array {
  return p256.getPublicKey(priv, false);
}

/** Validates a 65-byte uncompressed P-256 point from the device. */
export function assertUncompressedP256(pub: Uint8Array): void {
  if (pub.length !== 65 || pub[0] !== 0x04) {
    throw new Error("Expected a 65-byte uncompressed P-256 point.");
  }
  p256.ProjectivePoint.fromHex(pub).assertValidity();
}

/** ECDH x-coordinate, 32 bytes big-endian (elliptic `derive().toArray('be', 32)`). */
export function latticeSharedSecret(priv: Uint8Array, pub: Uint8Array): Uint8Array {
  assertUncompressedP256(pub);
  return p256.getSharedSecret(priv, pub, true).slice(1);
}

const AES_BLOCK = 16;

function aesCbcKey(key: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", key as BufferSource, { name: "AES-CBC" }, false, ["encrypt", "decrypt"]);
}

/**
 * AES-256-CBC, static IV, via WebCrypto. PKCS7 applies only to unaligned input,
 * as in gridplus-sdk. WebCrypto always pads, so aligned input yields one extra
 * whole block; CBC leaves every earlier block identical, so it is dropped.
 */
export async function latticeAesEncrypt(data: Uint8Array, key: Uint8Array): Promise<Uint8Array> {
  const out = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-CBC", iv: LATTICE_AES_IV as BufferSource }, await aesCbcKey(key), data as BufferSource),
  );
  return data.length % AES_BLOCK === 0 ? out.slice(0, data.length) : out;
}

/**
 * AES-256-CBC decryption without unpadding (Lattice frames are block-aligned).
 * WebCrypto requires PKCS7, so one block X is appended that decrypts to a full
 * padding block: X = AES_k(0x10^16 XOR C_last), computed as a one-block CBC
 * encryption under a zero IV. WebCrypto then strips exactly that block.
 */
export async function latticeAesDecrypt(data: Uint8Array, key: Uint8Array): Promise<Uint8Array> {
  if (data.length === 0 || data.length % AES_BLOCK !== 0) throw new Error("AES-CBC input must be block-aligned");
  const cryptoKey = await aesCbcKey(key);
  const last = data.subarray(data.length - AES_BLOCK);
  const target = new Uint8Array(AES_BLOCK).map((_, i) => 0x10 ^ last[i]);
  const extra = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-CBC", iv: new Uint8Array(AES_BLOCK) }, cryptoKey, target),
  ).slice(0, AES_BLOCK);
  const padded = new Uint8Array(data.length + AES_BLOCK);
  padded.set(data);
  padded.set(extra, data.length);
  return new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-CBC", iv: LATTICE_AES_IV as BufferSource }, cryptoKey, padded),
  );
}

/** First four bytes of sha256(secret), big-endian. */
export function latticeEphemeralId(secret: Uint8Array): number {
  return readU32BE(sha256(secret, "bytes"), 0);
}

/** ECDSA over a precomputed SHA-256 digest, DER, right-padded to 74 bytes. */
export function signDigestDerPadded(priv: Uint8Array, digest: Uint8Array): Uint8Array {
  const der = p256.sign(digest, priv, { prehash: false }).toDERRawBytes();
  if (der.length > LATTICE_DER_SIG_PADDED_SIZE) {
    throw new Error(`DER signature too large: ${der.length} bytes`);
  }
  const out = new Uint8Array(LATTICE_DER_SIG_PADDED_SIZE);
  out.set(der);
  return out;
}
