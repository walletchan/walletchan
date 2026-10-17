import { BUNKER_PENDING_KEY, readBunkerPendingIndex, projectBunkerPending, notifyBunkerPendingChanged } from "./pendingRequests";
import { decodeBase64Bounded, decodeBase64Exact } from "../cryptography/base64";
import { getCachedVaultKey } from "../sessionCache";
import { WALLET_SECRET_STORAGE_LOCK_KEY, withStorageLock } from "../storageLock";
import { decryptBunkerState, encryptBunkerState } from "./crypto";
import { exactRecord, assertBunkerDraftId, type BunkerCipher, type BunkerDraftEntry } from "./record";
import { loadBunkerDraftVault } from "./repository";
import { decodeBunkerState } from "./stateCodec";
import type { BunkerState } from "./types";

export const BUNKER_STATE_KEY = "safeBunkerJournalsV2";
interface StoredState { id: string; revision: number; cipher: BunkerCipher }
export async function loadStoredBunkerStates(): Promise<StoredState[]> {
  const raw = (await chrome.storage.local.get(BUNKER_STATE_KEY))[BUNKER_STATE_KEY];
  if (raw === undefined) return [];
  const v = exactRecord(raw, ["version", "entries"]);
  if (v.version !== 2 || !Array.isArray(v.entries) || v.entries.length > 100) throw new Error("Invalid Bunker state vault");
  const ids = new Set();
  return v.entries.map((candidate) => {
    const e = exactRecord(candidate, ["id", "revision", "cipher"]); assertBunkerDraftId(e.id);
    if (ids.has(e.id) || !Number.isSafeInteger(e.revision) || (e.revision as number) < 1) throw new Error("Invalid Bunker revision"); ids.add(e.id);
    const c = exactRecord(e.cipher, ["iv", "ciphertext"]);
    if (!decodeBase64Exact(c.iv, 12) || !decodeBase64Bounded(c.ciphertext, 32, 512 * 1024 + 16)) throw new Error("Invalid Bunker journal cipher");
    return e as unknown as StoredState;
  });
}
export async function readBunkerState(id: string, key = getCachedVaultKey()): Promise<BunkerState | null> {
  if (!key) throw new Error("Wallet is locked");
  const [states, vault] = await Promise.all([loadStoredBunkerStates(), loadBunkerDraftVault()]);
  const stored = states.find((s) => s.id === id); if (!stored) return null;
  const entry = vault.entries.find((e) => e.header.id === id); if (!entry) throw new Error("Bunker seed is missing");
  const state = decodeBunkerState(await decryptBunkerState(entry, key, stored.revision, stored.cipher));
  if (state.id !== id || state.chainId !== entry.header.chainId || state.seedGroupId !== entry.header.seedGroupId) throw new Error("Bunker journal identity mismatch");
  return state;
}
/** Caller holds the wallet operation lock; repository lock serializes accounts/state together. */
export async function writeBunkerState(state: BunkerState, current: () => CryptoKey, extra: Record<string, unknown> = {}, entryOverride?: BunkerDraftEntry) {
  return withStorageLock(WALLET_SECRET_STORAGE_LOCK_KEY, async () => {
    const key = current(); const checked = decodeBunkerState(state);
    const [stored, vault] = await Promise.all([loadStoredBunkerStates(), loadBunkerDraftVault()]);
    const entry = entryOverride ?? vault.entries.find((e) => e.header.id === state.id); if (!entry) throw new Error("Bunker seed is missing");
    const old = stored.find((e) => e.id === state.id); const revision = (old?.revision ?? 0) + 1;
    const cipher = await encryptBunkerState(entry, key, revision, checked);
    const pending = (await readBunkerPendingIndex()).filter((item) => item.accountId !== state.accountId);
    current();
    await chrome.storage.local.set({ ...extra, [BUNKER_PENDING_KEY]: [...pending, ...projectBunkerPending(checked)], [BUNKER_STATE_KEY]: { version: 2,
      entries: [...stored.filter((e) => e.id !== state.id), { id: state.id, revision, cipher }] } });
    current();
    notifyBunkerPendingChanged();
  });
}
