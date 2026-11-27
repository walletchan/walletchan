import { openHistoryDatabase } from "../history/database";
import type {
  SignatureHistoryState,
  StoredSignature,
  StoredSignatureAccount,
} from "./types";

export const MAX_SIGNATURE_ROWS = 10_000;
export const MAX_SIGNATURE_BYTES = 25 * 1024 * 1024;
export const MAX_SIGNATURE_PAYLOAD_BYTES = 768 * 1024;
const STORES = ["signatures", "signatureState", "signatureAccounts"];
function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Could not read signature history"));
  });
}
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () =>
      reject(tx.error ?? new Error("Could not save signature history"));
  });
}
export async function readSignatureState(): Promise<SignatureHistoryState> {
  const db = await openHistoryDatabase();
  const tx = db.transaction("signatureState", "readonly");
  return (
    (await result(tx.objectStore("signatureState").get("state"))) ?? {
      recordingStartedAt: null,
      prunedCount: 0,
    }
  );
}
export async function readStoredSignatures(
  ownerAddress?: string,
): Promise<StoredSignature[]> {
  const db = await openHistoryDatabase();
  const tx = db.transaction("signatures", "readonly");
  const store = tx.objectStore("signatures");
  return ownerAddress
    ? result(
        store
          .index("byOwnerCreated")
          .getAll(
            IDBKeyRange.bound(
              [ownerAddress.toLowerCase(), 0, ""],
              [ownerAddress.toLowerCase(), Number.MAX_SAFE_INTEGER, "\uffff"],
            ),
          ),
      )
    : result(store.getAll());
}
export async function readStoredSignatureAccount(
  id: string,
): Promise<StoredSignatureAccount | undefined> {
  const db = await openHistoryDatabase();
  return result(
    db
      .transaction("signatureAccounts", "readonly")
      .objectStore("signatureAccounts")
      .get(id),
  );
}

/** Delete metadata with no remaining signature, in the same mutation transaction. */
async function cleanupAccounts(tx: IDBTransaction): Promise<void> {
  const records = await result<StoredSignature[]>(
    tx.objectStore("signatures").getAll(),
  );
  const referenced = new Set(
    records.map((row) => row.accountId).filter(Boolean),
  );
  const accounts = tx.objectStore("signatureAccounts");
  const ids = await result(accounts.getAllKeys());
  for (const id of ids) if (!referenced.has(String(id))) accounts.delete(id);
}

/** Signature, shared metadata and retention commit atomically. */
export async function putStoredSignature(
  record: StoredSignature,
  account?: StoredSignatureAccount,
): Promise<void> {
  const db = await openHistoryDatabase();
  const tx = db.transaction(STORES, "readwrite");
  const completion = done(tx);
  const store = tx.objectStore("signatures");
  const accounts = tx.objectStore("signatureAccounts");
  const stateStore = tx.objectStore("signatureState");
  const existing = await result<StoredSignature | undefined>(
    store.get(record.id),
  );
  if (existing) {
    await completion;
    return;
  }
  const state = ((await result(stateStore.get("state"))) ?? {
    recordingStartedAt: record.createdAt,
    prunedCount: 0,
  }) as SignatureHistoryState;
  if (account && !(await result(accounts.get(account.id))))
    accounts.add(account);
  store.put(record);
  const records = await result<StoredSignature[]>(store.getAll());
  const metadata = new Map(
    (await result<StoredSignatureAccount[]>(accounts.getAll())).map((item) => [
      item.id,
      item,
    ]),
  );
  records.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
  let bytes = 0;
  let kept = 0;
  let pruning = false;
  const counted = new Set<string>();
  for (const item of records) {
    const accountBytes =
      item.accountId && !counted.has(item.accountId)
        ? (metadata.get(item.accountId)?.bytes ?? 0)
        : 0;
    if (
      pruning ||
      ++kept > MAX_SIGNATURE_ROWS ||
      bytes + item.bytes + accountBytes > MAX_SIGNATURE_BYTES
    ) {
      pruning = true;
      store.delete(item.id);
      state.prunedCount++;
    } else {
      bytes += item.bytes + accountBytes;
      if (item.accountId) counted.add(item.accountId);
    }
  }
  await cleanupAccounts(tx);
  stateStore.put(state, "state");
  await completion;
}
export async function removeStoredSignature(id: string): Promise<void> {
  const db = await openHistoryDatabase();
  const tx = db.transaction(STORES, "readwrite");
  const completion = done(tx);
  tx.objectStore("signatures").delete(id);
  await cleanupAccounts(tx);
  await completion;
}
export async function clearSignatureDatabase(
  ownerAddress?: string,
  reset = false,
): Promise<void> {
  const db = await openHistoryDatabase();
  const tx = db.transaction(STORES, "readwrite");
  const completion = done(tx);
  const store = tx.objectStore("signatures");
  if (ownerAddress) {
    const records = await result<StoredSignature[]>(store.getAll());
    for (const record of records)
      if (record.ownerAddress === ownerAddress.toLowerCase())
        store.delete(record.id);
    await cleanupAccounts(tx);
  } else {
    store.clear();
    tx.objectStore("signatureAccounts").clear();
  }
  if (reset) tx.objectStore("signatureState").clear();
  await completion;
}
