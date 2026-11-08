/**
 * P-256 keys, ECDH and AES-256-CBC with the Lattice static IV, all via WebCrypto.
 *
 * Ported from ape-grid-lattice `ape_grid/protocol/secure_channel.py`, which
 * mirrors gridplus-sdk `util.ts` and `shared/utilities.ts`.
 */
import { sha256 } from "viem";

import { concatBytes, readU32BE } from "./bytes";
import { LATTICE_AES_IV, LATTICE_DER_SIG_PADDED_SIZE } from "./constants";

/**
 * App key bytes: the 32-byte P-256 private scalar, then its 65-byte
 * uncompressed public key. WebCrypto cannot derive a public key from a bare
 * scalar, so the two halves are kept together.
 */
export const LATTICE_APP_KEY_SIZE = 97;

const P256_CURVE = "P-256";
const KEY_CHECK_MESSAGE = new TextEncoder().encode("WalletChan Lattice app key check");

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")), (char) => char.charCodeAt(0));
}

/** A new app key from WebCrypto. */
export async function generateLatticeAppKey(): Promise<Uint8Array> {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: P256_CURVE }, true, ["deriveBits"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  if (!jwk.d || !jwk.x || !jwk.y) throw new Error("WebCrypto returned an incomplete P-256 key.");
  const appKey = concatBytes(fromBase64Url(jwk.d), Uint8Array.of(0x04), fromBase64Url(jwk.x), fromBase64Url(jwk.y));
  assertLatticeAppKey(appKey);
  return appKey;
}

/** Shape check; `checkLatticeAppKey` confirms the key itself. */
export function assertLatticeAppKey(appKey: Uint8Array): void {
  if (appKey.length !== LATTICE_APP_KEY_SIZE || appKey[32] !== 0x04) {
    throw new Error("Lattice app key must be a P-256 private key followed by its 65-byte public key.");
  }
}

function appKeyJwk(appKey: Uint8Array) {
  assertLatticeAppKey(appKey);
  return {
    kty: "EC",
    crv: P256_CURVE,
    d: toBase64Url(appKey.subarray(0, 32)),
    x: toBase64Url(appKey.subarray(33, 65)),
    y: toBase64Url(appKey.subarray(65, 97)),
  };
}

function importAppKey(appKey: Uint8Array, algorithm: "ECDH" | "ECDSA"): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    appKeyJwk(appKey),
    { name: algorithm, namedCurve: P256_CURVE },
    false,
    algorithm === "ECDH" ? ["deriveBits"] : ["sign"],
  );
}

async function importP256Point(pub: Uint8Array, algorithm: "ECDH" | "ECDSA"): Promise<CryptoKey> {
  if (pub.length !== 65 || pub[0] !== 0x04) {
    throw new Error("Expected a 65-byte uncompressed P-256 point.");
  }
  try {
    return await crypto.subtle.importKey(
      "raw",
      pub as BufferSource,
      { name: algorithm, namedCurve: P256_CURVE },
      false,
      algorithm === "ECDH" ? [] : ["verify"],
    );
  } catch {
    throw new Error("Expected a 65-byte uncompressed P-256 point.");
  }
}

/**
 * Full check: WebCrypto accepts the scalar and the point, and a signature
 * made with the scalar verifies under the stored public key.
 */
export async function checkLatticeAppKey(appKey: Uint8Array): Promise<void> {
  try {
    const [signingKey, verifyingKey] = await Promise.all([
      importAppKey(appKey, "ECDSA"),
      importP256Point(appKey.subarray(32), "ECDSA"),
      importAppKey(appKey, "ECDH"),
    ]);
    const algorithm = { name: "ECDSA", hash: "SHA-256" };
    const signature = await crypto.subtle.sign(algorithm, signingKey, KEY_CHECK_MESSAGE);
    if (await crypto.subtle.verify(algorithm, verifyingKey, signature, KEY_CHECK_MESSAGE)) return;
  } catch {
    // reported below
  }
  throw new Error("Lattice app key is not a valid P-256 key pair.");
}

/** 65-byte uncompressed SEC1 point (0x04 || X || Y). */
export function latticeAppPublicKey(appKey: Uint8Array): Uint8Array {
  assertLatticeAppKey(appKey);
  return appKey.slice(32);
}

/** Validates a 65-byte uncompressed P-256 point from the device; WebCrypto rejects points off the curve. */
export async function assertUncompressedP256(pub: Uint8Array): Promise<void> {
  await importP256Point(pub, "ECDH");
}

/** ECDH x-coordinate, 32 bytes big-endian (elliptic `derive().toArray('be', 32)`). */
export async function latticeSharedSecret(appKey: Uint8Array, pub: Uint8Array): Promise<Uint8Array> {
  const [privateKey, publicKey] = await Promise.all([importAppKey(appKey, "ECDH"), importP256Point(pub, "ECDH")]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: publicKey }, privateKey, 256));
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

function derInteger(value: Uint8Array): Uint8Array {
  let start = 0;
  while (start < value.length - 1 && value[start] === 0) start += 1;
  const body = value.subarray(start);
  const pad = body[0] & 0x80 ? Uint8Array.of(0) : new Uint8Array(0);
  return concatBytes(Uint8Array.of(0x02, pad.length + body.length), pad, body);
}

/** DER `SEQUENCE { INTEGER r, INTEGER s }` from big-endian r and s of up to 32 bytes. */
export function encodeDerSignature(r: Uint8Array, s: Uint8Array): Uint8Array {
  const rInt = derInteger(r);
  const sInt = derInteger(s);
  return concatBytes(Uint8Array.of(0x30, rInt.length + sInt.length), rInt, sInt);
}

/** ECDSA over sha256(preimage), DER, right-padded to 74 bytes. */
export async function signSha256DerPadded(appKey: Uint8Array, preimage: Uint8Array): Promise<Uint8Array> {
  const raw = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await importAppKey(appKey, "ECDSA"), preimage as BufferSource),
  );
  const der = encodeDerSignature(raw.subarray(0, 32), raw.subarray(32, 64));
  if (der.length > LATTICE_DER_SIG_PADDED_SIZE) {
    throw new Error(`DER signature too large: ${der.length} bytes`);
  }
  const out = new Uint8Array(LATTICE_DER_SIG_PADDED_SIZE);
  out.set(der);
  return out;
}
