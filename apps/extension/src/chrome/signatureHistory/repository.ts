import { decryptWithVaultKey, encryptWithVaultKey } from "../crypto";
import {
  getCachedVaultKey,
  getPasswordType,
  tryRestoreSession,
} from "../sessionCache";
import {
  getAuthCeremonyEpoch,
  isCurrentAuthCeremonyEpoch,
} from "../authTransition";
import {
  WALLET_SECRET_OPERATION_LOCK_KEY,
  withStorageLock,
} from "../storageLock";
import {
  clearSignatureDatabase,
  MAX_SIGNATURE_PAYLOAD_BYTES,
  putStoredSignature,
  readSignatureState,
  readStoredSignatures,
  readStoredSignatureAccount,
  removeStoredSignature,
} from "./database";
import { jsonSafe, matchesSignatureFilter } from "./model";
import type {
  SignatureHistoryEntry,
  SignatureHistoryFilter,
  StoredSignature,
  StoredSignatureAccount,
  SignatureHistoryAccount,
  CompactSignatureEntry,
} from "./types";

const LOCK = "history:signatures";
const preparedSessions = new WeakMap<
  StoredSignature,
  { key: CryptoKey; epoch: string; account: StoredSignatureAccount }
>();
export function assertSignatureHistorySession(record: StoredSignature): void {
  const prepared = preparedSessions.get(record);
  if (
    !prepared ||
    !isCurrentAuthCeremonyEpoch(prepared.epoch) ||
    getCachedVaultKey() !== prepared.key ||
    !getPasswordType()
  ) {
    throw new Error("Authentication changed while recording the signature");
  }
}
function unlockedKey() {
  const key = getCachedVaultKey();
  if (!key || !getPasswordType())
    throw new Error("Unlock the wallet to access signed messages");
  return key;
}
async function restoreHistoryKey(): Promise<CryptoKey> {
  if (!getCachedVaultKey() || !getPasswordType()) {
    const { handleUnlockWallet } = await import("../authHandlers");
    await tryRestoreSession(handleUnlockWallet);
  }
  return unlockedKey();
}
export function notifySignatureHistoryUpdated(): void {
  void chrome.runtime
    .sendMessage({ type: "signatureHistoryUpdated" })
    .catch(() => {});
}
/** Encrypt before the final authority check. History never receives a signature or credential. */
export async function prepareSignatureHistory(
  entry: SignatureHistoryEntry,
): Promise<StoredSignature> {
  const plaintext = jsonSafe(entry);
  if (
    new TextEncoder().encode(plaintext).byteLength > MAX_SIGNATURE_PAYLOAD_BYTES
  ) {
    throw new Error("Signed message is too large to record safely");
  }
  const key = unlockedKey();
  const epoch = getAuthCeremonyEpoch();
  const metadata: SignatureHistoryAccount = {
    id: entry.accountId,
    address: entry.ownerAddress,
    type: entry.accountType,
  };
  const existingAccount = await readStoredSignatureAccount(metadata.id);
  if (existingAccount) {
    const decoded = await decryptWithVaultKey(key, existingAccount.encrypted);
    const prior = decoded
      ? (JSON.parse(decoded) as SignatureHistoryAccount)
      : null;
    if (
      !prior ||
      prior.id !== metadata.id ||
      prior.address !== metadata.address ||
      prior.type !== metadata.type
    )
      throw new Error("Signed message account integrity check failed");
  }
  const accountEncrypted =
    existingAccount?.encrypted ??
    (await encryptWithVaultKey(key, jsonSafe(metadata)));
  const account: StoredSignatureAccount = existingAccount ?? {
    id: metadata.id,
    encrypted: accountEncrypted,
    bytes:
      new TextEncoder().encode(JSON.stringify(accountEncrypted)).byteLength +
      128,
  };
  const {
    accountType: _accountType,
    ownerAddress: _ownerAddress,
    ...compact
  } = entry;
  const encrypted = await encryptWithVaultKey(key, jsonSafe(compact));
  const record: StoredSignature = {
    id: entry.id,
    accountId: entry.accountId,
    ownerAddress: entry.ownerAddress,
    createdAt: entry.createdAt,
    encrypted,
    bytes: new TextEncoder().encode(JSON.stringify(encrypted)).byteLength + 256,
  };
  preparedSessions.set(record, { key, epoch, account });
  assertSignatureHistorySession(record);
  return record;
}
export async function commitSignatureHistory(
  record: StoredSignature,
): Promise<void> {
  assertSignatureHistorySession(record);
  await withStorageLock(LOCK, () => {
    assertSignatureHistorySession(record);
    return putStoredSignature(record, preparedSessions.get(record)!.account);
  });
  try {
    assertSignatureHistorySession(record);
  } catch (error) {
    await discardSignatureHistory(record.id);
    throw error;
  }
  notifySignatureHistoryUpdated();
}
export async function discardSignatureHistory(id: string): Promise<void> {
  await withStorageLock(LOCK, () => removeStoredSignature(id));
  notifySignatureHistoryUpdated();
}
export async function getSignatureHistory(
  filter: SignatureHistoryFilter = {},
): Promise<{
  entries: SignatureHistoryEntry[];
  state: Awaited<ReturnType<typeof readSignatureState>>;
}> {
  const key = await restoreHistoryKey();
  const epoch = getAuthCeremonyEpoch();
  return withStorageLock(LOCK, async () => {
    const state = await readSignatureState();
    const records = await readStoredSignatures(filter.ownerAddress);
    const entries: SignatureHistoryEntry[] = [];
    const accountCache = new Map<string, SignatureHistoryAccount>();
    for (const record of records) {
      if (
        (filter.from !== undefined && record.createdAt < filter.from) ||
        (filter.to !== undefined && record.createdAt > filter.to)
      )
        continue;
      const plaintext = await decryptWithVaultKey(key, record.encrypted);
      if (!plaintext)
        throw new Error("Could not decrypt signed message history");
      const decoded = JSON.parse(plaintext) as CompactSignatureEntry;
      let account = accountCache.get(decoded.accountId);
      if (!account) {
        const metadata = await readStoredSignatureAccount(decoded.accountId);
        const plaintextAccount =
          metadata && (await decryptWithVaultKey(key, metadata.encrypted));
        account = plaintextAccount
          ? (JSON.parse(plaintextAccount) as SignatureHistoryAccount)
          : undefined;
        if (account) accountCache.set(decoded.accountId, account);
      }
      if (
        !account ||
        account.id !== decoded.accountId ||
        account.address !== record.ownerAddress ||
        record.accountId !== decoded.accountId
      )
        throw new Error("Signed message account integrity check failed");
      const entry: SignatureHistoryEntry = {
        ...decoded,
        ownerAddress: account.address,
        accountType: account.type,
      };
      // The encrypted identity prevents ciphertext being moved between public index rows.
      if (
        entry.version !== 1 ||
        entry.id !== record.id ||
        entry.ownerAddress !== record.ownerAddress ||
        entry.createdAt !== record.createdAt
      ) {
        throw new Error("Signed message history integrity check failed");
      }
      if (matchesSignatureFilter(entry, filter)) entries.push(entry);
    }
    if (
      !isCurrentAuthCeremonyEpoch(epoch) ||
      getCachedVaultKey() !== key ||
      !getPasswordType()
    ) {
      throw new Error("Wallet locked while reading signed messages");
    }
    return {
      entries: entries.sort(
        (a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id),
      ),
      state,
    };
  });
}
export async function clearSignatureHistory(
  ownerAddress?: string,
): Promise<void> {
  await restoreHistoryKey();
  await withStorageLock(WALLET_SECRET_OPERATION_LOCK_KEY, async () => {
    unlockedKey();
    await withStorageLock(LOCK, () => clearSignatureDatabase(ownerAddress));
  });
  notifySignatureHistoryUpdated();
}
