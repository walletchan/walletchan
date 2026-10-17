import { BUNKER_DRAFT_VAULT_KEY, decodeBunkerDraftVault } from "./record";

/** Missing is empty without writing. Malformed/future data is never repaired or dropped. */
export async function loadBunkerDraftVault() {
  const stored = await chrome.storage.local.get(BUNKER_DRAFT_VAULT_KEY);
  return decodeBunkerDraftVault(stored[BUNKER_DRAFT_VAULT_KEY]);
}
