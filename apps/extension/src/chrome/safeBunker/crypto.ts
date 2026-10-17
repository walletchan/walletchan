import { arrayBufferToBase64, decodeBase64Exact, decodeBase64Bounded } from "../cryptography/base64";
import { importVaultKey } from "../cryptography/vaultKey";
import { assertBunkerSeed } from "./derivation";
import { headerJson, type BunkerCipher, type BunkerDraftEntry, type BunkerDraftHeader } from "./record";

const encoder = new TextEncoder();
const aad = (header: BunkerDraftHeader, purpose: string) =>
  encoder.encode(`WalletChan.SafeBunker.client-rotation.v1:${purpose}:${headerJson(header)}`);
async function seal(key: CryptoKey, data: Uint8Array, header: BunkerDraftHeader, purpose: string): Promise<BunkerCipher> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv.buffer as ArrayBuffer,
    additionalData: aad(header, purpose).buffer as ArrayBuffer, tagLength: 128 }, key, data.buffer as ArrayBuffer);
  return { iv: arrayBufferToBase64(iv.buffer), ciphertext: arrayBufferToBase64(ciphertext) };
}
async function open(key: CryptoKey, cipher: BunkerCipher, header: BunkerDraftHeader, purpose: string, maxBytes = 528): Promise<Uint8Array> {
  const iv = decodeBase64Exact(cipher.iv, 12);
  const data = decodeBase64Bounded(cipher.ciphertext, 32, maxBytes);
  if (!iv || !data) throw new Error("Invalid Bunker ciphertext");
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv.buffer as ArrayBuffer,
    additionalData: aad(header, purpose).buffer as ArrayBuffer, tagLength: 128 }, key, data.buffer as ArrayBuffer));
}
export async function encryptBunkerDraft(header: BunkerDraftHeader, seed: string, vaultKey: CryptoKey): Promise<BunkerDraftEntry> {
  assertBunkerSeed(seed);
  const bytes = encoder.encode(seed);
  const raw = crypto.getRandomValues(new Uint8Array(32));
  try {
    const key = await importVaultKey(raw);
    return { header, seed: await seal(key, bytes, header, "seed"),
      wrappedKey: await seal(vaultKey, raw, header, "execution-key") };
  } finally { raw.fill(0); bytes.fill(0); }
}
/** No seed is cached; only explicit master-authorized reveal can release it. */
export async function withBunkerDraftSeed<T>(entry: BunkerDraftEntry, vaultKey: CryptoKey, use: (seed: string) => T | Promise<T>): Promise<T> {
  const raw = await open(vaultKey, entry.wrappedKey, entry.header, "execution-key");
  let bytes: Uint8Array | undefined;
  try {
    if (raw.length !== 32) throw new Error("Invalid Bunker encryption key");
    bytes = await open(await importVaultKey(raw), entry.seed, entry.header, "seed");
    const seed = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    assertBunkerSeed(seed);
    return await use(seed);
  } finally { raw.fill(0); bytes?.fill(0); }
}

export async function withBunkerDraftKey<T>(entry: BunkerDraftEntry, vaultKey: CryptoKey, use: (key: CryptoKey) => Promise<T>): Promise<T> {
  const raw = await open(vaultKey, entry.wrappedKey, entry.header, "execution-key");
  try { if (raw.length !== 32) throw new Error("Invalid Bunker key"); return await use(await importVaultKey(raw)); }
  finally { raw.fill(0); }
}
export async function encryptBunkerState(entry: BunkerDraftEntry, key: CryptoKey, revision: number, state: unknown): Promise<BunkerCipher> {
  const bytes = encoder.encode(JSON.stringify(state));
  if (bytes.length > 512 * 1024) throw new Error("Bunker journal limit reached");
  try { return await withBunkerDraftKey(entry, key, (dek) => seal(dek, bytes, entry.header, `journal:${revision}`)); }
  finally { bytes.fill(0); }
}
export async function decryptBunkerState(entry: BunkerDraftEntry, key: CryptoKey, revision: number, cipher: BunkerCipher): Promise<unknown> {
  return withBunkerDraftKey(entry, key, async (dek) => {
    const bytes = await open(dek, cipher, entry.header, `journal:${revision}`, 512 * 1024 + 16);
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    finally { bytes.fill(0); }
  });
}
