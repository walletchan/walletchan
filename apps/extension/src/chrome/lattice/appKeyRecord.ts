/**
 * Pure, session-free helpers for the stored Lattice pairing key record.
 * Vault integrity checks import this module; it must not import session or
 * orchestration layers.
 */
import { bytesToHex, hexToBytes } from "viem";
import { decryptWithVaultKey, encryptWithVaultKey } from "../crypto";
import { assertLatticeAppPrivateKey } from "./protocol/secureChannel";

export const LATTICE_APP_KEY_STORAGE_KEY = "latticeAppKeyVault";

export interface StoredLatticeAppKey {
  version: 1;
  ciphertext: string;
  iv: string;
  salt: "";
}

export function isStoredLatticeAppKey(value: unknown): value is StoredLatticeAppKey {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record.version === 1 &&
    typeof record.ciphertext === "string" &&
    record.ciphertext.length > 0 &&
    record.ciphertext.length <= 4096 &&
    typeof record.iv === "string" &&
    record.iv.length > 0 &&
    record.iv.length <= 64 &&
    record.salt === ""
  );
}

/** Decrypts a stored record; null when it cannot be recovered with this key. */
export async function decryptLatticeAppKey(
  vaultKey: CryptoKey,
  record: StoredLatticeAppKey,
): Promise<Uint8Array | null> {
  const plaintext = await decryptWithVaultKey(vaultKey, record);
  if (!plaintext || !/^0x[0-9a-f]{64}$/.test(plaintext)) return null;
  const key = hexToBytes(plaintext as `0x${string}`);
  try {
    assertLatticeAppPrivateKey(key);
  } catch {
    return null;
  }
  return key;
}

export async function encryptLatticeAppKey(
  vaultKey: CryptoKey,
  appKey: Uint8Array,
): Promise<StoredLatticeAppKey> {
  assertLatticeAppPrivateKey(appKey);
  const encrypted = await encryptWithVaultKey(vaultKey, bytesToHex(appKey));
  return { version: 1, ciphertext: encrypted.ciphertext, iv: encrypted.iv, salt: "" };
}
