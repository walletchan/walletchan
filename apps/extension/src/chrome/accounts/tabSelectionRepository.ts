/** Device-local tab selections, with an idempotent migration from sync. */
import { withStorageLock } from "../storageLock";

export const TAB_ACCOUNTS_KEY = "tabAccounts";
export const TAB_ACCOUNTS_LOCK_KEY = "local:tabAccounts";

function decodeTabAccounts(value: unknown): Record<number, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([tabId, accountId]) =>
        /^(0|[1-9]\d*)$/.test(tabId) &&
        Number.isSafeInteger(Number(tabId)) &&
        typeof accountId === "string" &&
        accountId.length > 0 &&
        accountId.length <= 512,
    ),
  );
}

/** Caller holds TAB_ACCOUNTS_LOCK_KEY; local presence is the migration commit. */
export async function readTabAccountsUnderLock(): Promise<
  Record<number, string>
> {
  const [local, legacy] = await Promise.all([
    chrome.storage.local.get(TAB_ACCOUNTS_KEY),
    chrome.storage.sync.get(TAB_ACCOUNTS_KEY),
  ]);
  const migrated = Object.prototype.hasOwnProperty.call(
    local,
    TAB_ACCOUNTS_KEY,
  );
  const accounts = decodeTabAccounts(
    migrated ? local[TAB_ACCOUNTS_KEY] : legacy[TAB_ACCOUNTS_KEY],
  );
  if (!migrated) await writeTabAccountsUnderLock(accounts);
  // Keep the released sync value for one compatibility cycle. It is never
  // written again, and even an empty local map remains authoritative.
  return accounts;
}

export function writeTabAccountsUnderLock(
  accounts: Record<number, string>,
): Promise<void> {
  return chrome.storage.local.set({ [TAB_ACCOUNTS_KEY]: accounts });
}

export async function migrateTabAccountStorage(): Promise<void> {
  await withStorageLock(TAB_ACCOUNTS_LOCK_KEY, readTabAccountsUnderLock);
}
