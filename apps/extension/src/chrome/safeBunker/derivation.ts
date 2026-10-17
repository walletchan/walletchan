import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { HDKey } from "@scure/bip32";
import { bytesToHex } from "viem";
import { privateKeyToAddress } from "viem/accounts";

export const BUNKER_DERIVATION_PREFIX = "m/44'/60'/0'/0'";
export const MAX_BUNKER_OWNER_INDEX = 0x7fffffff;

export function assertBunkerSeed(seed: string): void {
  if (typeof seed !== "string" || seed.length > 512 ||
      seed !== seed.trim().toLowerCase() || seed.split(" ").length !== 12 ||
      !validateMnemonic(seed, wordlist)) throw new Error("Invalid Bunker seed phrase");
}

export function generateBunkerSeed(): string {
  return generateMnemonic(wordlist, 128);
}

/** Background call-stack only. Never exported through a message route. */
export async function withBunkerOwnerKey<T>(seed: string, index: number, use: (key: `0x${string}`) => Promise<T>): Promise<T> {
  assertBunkerSeed(seed);
  if (!Number.isSafeInteger(index) || index < 0 || index > MAX_BUNKER_OWNER_INDEX)
    throw new Error("Invalid Bunker owner index");
  const bytes = mnemonicToSeedSync(seed);
  const root = HDKey.fromMasterSeed(bytes);
  let node = root;
  try {
    for (const part of [44, 60, 0, 0, index]) {
      const next = node.deriveChild(0x80000000 + part);
      if (node !== root) node.wipePrivateData();
      node = next;
    }
    if (!node.privateKey) throw new Error("Bunker owner derivation failed");
    return await use(bytesToHex(node.privateKey));
  } finally {
    node.wipePrivateData();
    root.wipePrivateData();
    bytes.fill(0);
  }
}

export function deriveBunkerOwner(seed: string, index: number): `0x${string}` {
  assertBunkerSeed(seed);
  if (!Number.isSafeInteger(index) || index < 0 || index > MAX_BUNKER_OWNER_INDEX)
    throw new Error("Invalid Bunker owner index");
  const bytes = mnemonicToSeedSync(seed);
  const root = HDKey.fromMasterSeed(bytes);
  let node = root;
  try {
    for (const part of [44, 60, 0, 0, index]) {
      const next = node.deriveChild(0x80000000 + part);
      if (node !== root) node.wipePrivateData();
      node = next;
    }
    if (!node.privateKey) throw new Error("Bunker owner derivation failed");
    return privateKeyToAddress(bytesToHex(node.privateKey)).toLowerCase() as `0x${string}`;
  } finally {
    node.wipePrivateData();
    root.wipePrivateData();
    bytes.fill(0);
  }
}
