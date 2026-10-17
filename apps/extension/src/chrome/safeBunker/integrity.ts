import { readSignedBunkerDeployment } from "./deploymentPublication";
import { readBunkerState, loadStoredBunkerStates } from "./stateRepository";
import { withBunkerDraftSeed } from "./crypto";
import { deriveBunkerOwner } from "./derivation";
import { loadBunkerDraftVault } from "./repository";

/** Pure recovery proof relative to the supplied vault key; never populates key caches. */
export async function assertBunkerDraftIntegrity(vaultKey: CryptoKey): Promise<void> {
  const vault = await loadBunkerDraftVault();
  const journal = await loadStoredBunkerStates();
  const accountsOnly = (await chrome.storage.local.get("accounts")).accounts ?? [];
  if (!vault.entries.length && !journal.length && !accountsOnly.some((a: { type: string }) => a.type === "safeBunker")) return;
  const stored = await chrome.storage.local.get(["accounts", "seedGroups", "pkVault"]);
  const ids = new Set([
    ...(stored.accounts ?? []).filter((a: { type: string }) => a.type !== "safeBunker").map((a: { id: string }) => a.id),
    ...(stored.seedGroups ?? []).map((g: { id: string }) => g.id),
    ...(stored.pkVault?.entries ?? []).map((e: { id: string }) => e.id),
  ]);
  for (const record of journal) if (!vault.entries.some((e) => e.header.id === record.id)) throw new Error("Bunker journal seed is missing");
  for (const account of stored.accounts ?? []) if (account.type === "safeBunker") {
    const state = await readBunkerState(account.seedVaultId, vaultKey);
    if (!state || state.archived || state.accountId !== account.id || state.plan.address !== account.address.toLowerCase() || account.chainId !== 11155111) throw new Error("Bunker account binding changed");
    if (!state.activated) {
      if (account.deploymentPending !== true) throw new Error("Bunker account binding changed");
      await readSignedBunkerDeployment(state);
    } else if (account.deploymentPending !== undefined) throw new Error("Bunker account binding changed");
  }
  for (const entry of vault.entries) {
    await readBunkerState(entry.header.id, vaultKey);
    if (ids.has(entry.header.id)) throw new Error("Bunker draft identity collision");
    await withBunkerDraftSeed(entry, vaultKey, (seed) => {
      if (deriveBunkerOwner(seed, 0) !== entry.header.firstOwner)
        throw new Error("Bunker seed does not match its initial owner");
    });
  }
}
