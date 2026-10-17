/** Shared last-account cleanup. Caller holds the wallet operation lock. */
import { getAccounts } from "./repository";
import { getSeedGroups } from "./seedGroupStorage";
import { assertAccountStorageAuthorized } from "./authorization";
import { loadMnemonicVault } from "../mnemonic/repository";
import { WALLET_SECRET_STORAGE_LOCK_KEY, withStorageLock } from "../storageLock";
import { readBunkerInbox } from "../safeBunker/inbox";
import type { Account } from "../types";
import { loadBunkerDraftVault } from "../safeBunker/repository";
import { BUNKER_DRAFT_VAULT_KEY } from "../safeBunker/record";
import { BUNKER_STATE_KEY, loadStoredBunkerStates, readBunkerState } from "../safeBunker/stateRepository";
import { BUNKER_PENDING_KEY, readBunkerPendingIndex, notifyBunkerPendingChanged } from "../safeBunker/pendingRequests";

export async function cleanupRemovedSeedAccount(
  seedGroupId: string,
  options: { remainingAccounts?: Account[]; bunkerId?: string; authorize?: () => unknown; expectedAuthEpoch?: string } = {},
): Promise<void> {
  await withStorageLock("local:safeBunkerInboxV1", () => withStorageLock(WALLET_SECRET_STORAGE_LOCK_KEY, async () => {
    const authorize = () => { options.authorize?.(); assertAccountStorageAuthorized(options.expectedAuthEpoch); };
    authorize();
    const accounts = options.remainingAccounts ?? await getAccounts();
    const related = accounts.filter(a => (a.type === "seedPhrase" || a.type === "safeBunker") && a.seedGroupId === seedGroupId);
    const last = related.length === 0;
    const groups = await getSeedGroups();
    const patch: Record<string, unknown> = {
      seedGroups: last ? groups.filter(g => g.id !== seedGroupId) : groups.map(g => g.id === seedGroupId
        ? { ...g, accountCount: related.filter(a => a.type === "seedPhrase").length } : g),
      ...(options.remainingAccounts ? { accounts } : {}),
    };
    const bindings = await loadBunkerDraftVault();
    const ids = new Set(bindings.entries.filter(e => last ? e.header.seedGroupId === seedGroupId : e.header.id === options.bunkerId).map(e => e.header.id));
    if (ids.size) {
      const journals = await loadStoredBunkerStates();
      const removedAccountIds = new Set<string>();
      for (const id of ids) {
        const state = await readBunkerState(id);
        if (!state) continue;
        if ((!state.activated && state.plan.deploymentHash) || state.operations.some(o =>
          !!o.signature && !["confirmed", "invalidated"].includes(o.state) || ["queued", "reviewed"].includes(o.state)))
          throw new Error("Resolve Bunker requests before removal");
        removedAccountIds.add(state.accountId);
      }
      if ((await readBunkerInbox()).some(e => removedAccountIds.has(e.accountId)))
        throw new Error("Resolve Bunker requests before removal");
      patch[BUNKER_DRAFT_VAULT_KEY] = { ...bindings, entries: bindings.entries.filter(e => !ids.has(e.header.id)) };
      patch[BUNKER_STATE_KEY] = { version: 2, entries: journals.filter(e => !ids.has(e.id)) };
      patch[BUNKER_PENDING_KEY] = (await readBunkerPendingIndex()).filter(e => !removedAccountIds.has(e.accountId));
    }
    if (last) {
      const vault = await loadMnemonicVault();
      if (vault) patch.mnemonicVault = { ...vault, entries: vault.entries.filter(e => e.id !== seedGroupId),
        ...(vault.version === 2 ? { revision: vault.revision + 1 } : {}) };
    }
    authorize();
    // Account, source metadata, encrypted phrase and Bunker records commit together.
    await chrome.storage.local.set(patch);
  }));
  notifyBunkerPendingChanged();
}
