import { readSignedBunkerDeployment } from "./deploymentPublication";
import { readBunkerState, loadStoredBunkerStates } from "./stateRepository";
import { loadBunkerDraftVault } from "./repository";
/** Recovery proof relative to supplied general vault key; no session cache writes. */
export async function assertBunkerDraftIntegrity(vaultKey: CryptoKey): Promise<void> {
  const vault = await loadBunkerDraftVault(), journals = await loadStoredBunkerStates();
  const { accounts = [], seedGroups = [] } = await chrome.storage.local.get(["accounts", "seedGroups"]);
  const { mnemonicVault } = await chrome.storage.local.get("mnemonicVault");
  for (const entry of vault.entries) {
    if (!seedGroups.some((g: { id: string }) => g.id === entry.header.seedGroupId) ||
        !mnemonicVault?.entries?.some((e: { id: string }) => e.id === entry.header.seedGroupId))
      throw new Error("Bunker source phrase is missing");
    await readBunkerState(entry.header.id, vaultKey);
  }
  for (const record of journals) if (!vault.entries.some(e => e.header.id === record.id)) throw new Error("Bunker journal binding is missing");
  for (const account of accounts) if (account.type === "safeBunker") {
    const state = await readBunkerState(account.bunkerId, vaultKey);
    if (!state || state.archived || state.accountId !== account.id || state.plan.address !== account.address.toLowerCase() ||
        account.chainId !== state.chainId || account.seedGroupId !== state.seedGroupId || account.derivationVersion !== 2) throw new Error("Bunker account binding changed");
    if (!state.activated) {
      if (account.deploymentPending !== true) throw new Error("Bunker account binding changed");
      await readSignedBunkerDeployment(state);
    } else if (account.deploymentPending !== undefined) throw new Error("Bunker account binding changed");
  }
}
