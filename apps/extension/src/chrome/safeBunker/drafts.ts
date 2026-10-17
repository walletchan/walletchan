/** Internal deterministic source/chain preparation; never a saved-setup UI. */
import { captureBunkerAccess } from "./access";
import { withBunkerSourcePhrase } from "./sources";
import { deriveBunkerOwner } from "./derivation";
import { loadBunkerDraftVault } from "./repository";
import { BUNKER_DRAFT_VAULT_KEY, decodeBunkerDraftVault, summarizeBunkerDraft } from "./record";
import { getStoredChainName } from "@/lib/chains";
import { assertBunkerChainId } from "./chainIdentity";
import { WALLET_SECRET_OPERATION_LOCK_KEY, withStorageLock } from "../storageLock";
export async function createBunkerDraft(seedGroupId: string, chainId: number) {
  const current = captureBunkerAccess(); assertBunkerChainId(chainId);
  current();
  const name = `SafeBunker - ${await getStoredChainName(chainId)}`;
  return withStorageLock(WALLET_SECRET_OPERATION_LOCK_KEY, async () => {
    const firstOwner = await withBunkerSourcePhrase(seedGroupId, phrase => deriveBunkerOwner(phrase, chainId, 0)); current();
    const id = `bunker-source:${chainId}:${firstOwner}`;
    const vault = await loadBunkerDraftVault(); current();
    const previous = vault.entries.find(e => e.header.id === id);
    if (previous) return summarizeBunkerDraft(previous);
    const entry = { header: { id, seedGroupId, name, chainId, derivationVersion: 2 as const, firstOwner, createdAt: Date.now() } };
    const next = decodeBunkerDraftVault({ ...vault, entries: [...vault.entries, entry] });
    current(); await chrome.storage.local.set({ [BUNKER_DRAFT_VAULT_KEY]: next }); current();
    return summarizeBunkerDraft(entry);
  });
}
