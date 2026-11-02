/**
 * The Lattice pairing key: one P-256 app key per wallet, trusted by every
 * Lattice paired with WalletChan. It is a credential, so it lives encrypted
 * with the general vault key (like the Bankr credential) and is never revealed.
 * Agent and passkey sessions can use it to request signatures; the Lattice
 * still requires approval on its own screen.
 */
import { getCachedVaultKey } from "../sessionCache";
import {
  LATTICE_APP_KEY_STORAGE_KEY,
  decryptLatticeAppKey,
  isStoredLatticeAppKey,
  type StoredLatticeAppKey,
} from "./appKeyRecord";
import { LatticeError, LatticeErrorCode, NOT_PAIRED_MESSAGE } from "./errors";

export {
  LATTICE_APP_KEY_STORAGE_KEY,
  decryptLatticeAppKey,
  encryptLatticeAppKey,
  isStoredLatticeAppKey,
  type StoredLatticeAppKey,
} from "./appKeyRecord";

export async function readStoredLatticeAppKeyRecord(): Promise<StoredLatticeAppKey | null> {
  const stored = await chrome.storage.local.get(LATTICE_APP_KEY_STORAGE_KEY);
  const value = stored[LATTICE_APP_KEY_STORAGE_KEY];
  if (value === undefined || value === null) return null;
  if (!isStoredLatticeAppKey(value)) {
    throw new LatticeError(LatticeErrorCode.NOT_CONFIGURED, NOT_PAIRED_MESSAGE);
  }
  return value;
}

/** The stored pairing key, or null when none exists yet. Requires an unlocked wallet. */
export async function loadLatticeAppKey(): Promise<Uint8Array | null> {
  const record = await readStoredLatticeAppKeyRecord();
  if (!record) return null;
  const vaultKey = getCachedVaultKey();
  if (!vaultKey) {
    throw new LatticeError(LatticeErrorCode.WALLET_LOCKED, "Unlock WalletChan to use your Lattice.");
  }
  const key = await decryptLatticeAppKey(vaultKey, record);
  if (!key) {
    throw new LatticeError(LatticeErrorCode.NOT_CONFIGURED, NOT_PAIRED_MESSAGE);
  }
  return key;
}

export async function requireLatticeAppKey(): Promise<Uint8Array> {
  const key = await loadLatticeAppKey();
  if (!key) {
    throw new LatticeError(LatticeErrorCode.NOT_PAIRED, NOT_PAIRED_MESSAGE);
  }
  return key;
}
