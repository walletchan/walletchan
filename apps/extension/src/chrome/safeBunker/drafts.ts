import { readBunkerState } from "./stateRepository";
import { getAuthCeremonyEpoch } from "../authTransition";
import { assertCurrentMasterAuthorization } from "../secrets/masterAuthorization";
import { getCachedVaultKey } from "../sessionCache";
import { WALLET_SECRET_OPERATION_LOCK_KEY, withStorageLock } from "../storageLock";
import { encryptBunkerDraft, withBunkerDraftSeed } from "./crypto";
import { deriveBunkerOwner, generateBunkerSeed } from "./derivation";
import { assertBunkerDraftIntegrity } from "./integrity";
import { BUNKER_DRAFT_VAULT_KEY, MAX_BUNKER_DRAFTS, assertBunkerDraftId,
  decodeBunkerDraftVault, summarizeBunkerDraft, type BunkerDraftSummary } from "./record";
import { loadBunkerDraftVault } from "./repository";

/** Capture before waiting, so a later unlock cannot authorize earlier queued work. */
export function captureBunkerDraftAccess() {
  const epoch = getAuthCeremonyEpoch();
  const key = getCachedVaultKey();
  const assert = () => {
    assertCurrentMasterAuthorization(epoch);
    if (!key || getCachedVaultKey() !== key) throw new Error("Unlock with master authority to manage Bunker drafts");
    return key;
  };
  assert();
  return assert;
}

export async function listBunkerDrafts(): Promise<BunkerDraftSummary[]> {
  const current = captureBunkerDraftAccess();
  return withStorageLock(WALLET_SECRET_OPERATION_LOCK_KEY, async () => {
    await assertBunkerDraftIntegrity(current());
    const vault = await loadBunkerDraftVault();
    current();
    const summaries = await Promise.all(vault.entries.map(async (entry) => {
      const state = await readBunkerState(entry.header.id, current());
      return state?.activated ? null : summarizeBunkerDraft(entry);
    }));
    current(); return summaries.filter((entry): entry is BunkerDraftSummary => entry !== null);
  });
}

export async function createBunkerDraft(id: unknown, name: unknown): Promise<BunkerDraftSummary> {
  const current = captureBunkerDraftAccess();
  assertBunkerDraftId(id);
  if (typeof name !== "string" || !name.trim() || name.trim().length > 64)
    throw new Error("Enter a Bunker name of 1–64 characters");
  const label = name.trim();
  return withStorageLock(WALLET_SECRET_OPERATION_LOCK_KEY, async () => {
    await assertBunkerDraftIntegrity(current());
    const vault = await loadBunkerDraftVault();
    const previous = vault.entries.find((e) => e.header.id === id);
    if (previous) {
      if (previous.header.name !== label) throw new Error("Bunker creation details changed; reopen setup");
      current();
      return summarizeBunkerDraft(previous);
    }
    if (vault.entries.length >= MAX_BUNKER_DRAFTS) throw new Error("Bunker draft limit reached");
    const seed = generateBunkerSeed();
    const entry = await encryptBunkerDraft({ id, name: label, chainId: 11155111,
      derivationVersion: 1, firstOwner: deriveBunkerOwner(seed, 0), createdAt: Date.now() }, seed, current());
    const next = decodeBunkerDraftVault({ version: 1, entries: [...vault.entries, entry] });
    // Collision check includes this new identity, not only preexisting drafts.
    const stored = await chrome.storage.local.get(["accounts", "seedGroups", "pkVault"]);
    if ([...(stored.accounts ?? []), ...(stored.seedGroups ?? []), ...(stored.pkVault?.entries ?? [])]
      .some((e: { id: string }) => e.id === id)) throw new Error("Bunker draft identity collision");
    current();
    await chrome.storage.local.set({ [BUNKER_DRAFT_VAULT_KEY]: next });
    current();
    return summarizeBunkerDraft(entry);
  });
}

/** Shared reveal handler holds the operation lock and has explicitly verified master password. */
export async function readBunkerDraftSeed(id: string, epoch: string): Promise<string | null> {
  if (!id.startsWith("bunker-draft:")) return null;
  assertBunkerDraftId(id);
  const current = captureBunkerDraftAccess();
  assertCurrentMasterAuthorization(epoch);
  const entry = (await loadBunkerDraftVault()).entries.find((e) => e.header.id === id);
  if (!entry) throw new Error("Bunker draft not found");
  return withBunkerDraftSeed(entry, current(), (seed) => {
    if (deriveBunkerOwner(seed, 0) !== entry.header.firstOwner) throw new Error("Bunker seed binding changed");
    assertCurrentMasterAuthorization(epoch);
    current();
    return seed;
  });
}
