import { arrayBufferToBase64, decodeBase64Exact, decodeBase64Bounded } from "../cryptography/base64";
import { captureBunkerAccess } from "./access";
import { withBunkerSourcePhrase } from "./sources";
import { headerJson, type BunkerCipher, type BunkerDraftEntry } from "./record";
const encoder = new TextEncoder();
async function seal(key: CryptoKey, bytes: Uint8Array, context: string): Promise<BunkerCipher> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv.buffer as ArrayBuffer,
    additionalData: encoder.encode(context), tagLength: 128 }, key, bytes.buffer as ArrayBuffer);
  return { iv: arrayBufferToBase64(iv.buffer), ciphertext: arrayBufferToBase64(ciphertext) };
}
async function open(key: CryptoKey, cipher: BunkerCipher, context: string): Promise<Uint8Array> {
  const iv = decodeBase64Exact(cipher.iv, 12), bytes = decodeBase64Bounded(cipher.ciphertext, 32, 512 * 1024 + 16);
  if (!iv || !bytes) throw new Error("Invalid Bunker ciphertext");
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv.buffer as ArrayBuffer, additionalData: encoder.encode(context), tagLength: 128 }, key, bytes.buffer as ArrayBuffer));
}
/** Read the original mnemonic through its existing master-only capability. */
export async function withBunkerDraftSeed<T>(entry: BunkerDraftEntry, key: CryptoKey, use: (phrase: string) => T | Promise<T>): Promise<T> {
  const current = captureBunkerAccess();
  if (current() !== key) throw new Error("Authentication changed. Unlock and retry.");
  return withBunkerSourcePhrase(entry.header.seedGroupId, async phrase => {
    if (current() !== key) throw new Error("Authentication changed. Unlock and retry.");
    return use(phrase);
  });
}
const context = (entry: BunkerDraftEntry, revision: number) => `WalletChan.BunkerJournal.v2:${headerJson(entry.header)}:${revision}`;
export async function encryptBunkerState(entry: BunkerDraftEntry, key: CryptoKey, revision: number, state: unknown) {
  const bytes = encoder.encode(JSON.stringify(state));
  if (bytes.length > 512 * 1024) throw new Error("Bunker journal limit reached");
  try { return await seal(key, bytes, context(entry, revision)); } finally { bytes.fill(0); }
}
export async function decryptBunkerState(entry: BunkerDraftEntry, key: CryptoKey, revision: number, cipher: BunkerCipher) {
  const bytes = await open(key, cipher, context(entry, revision));
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } finally { bytes.fill(0); }
}
