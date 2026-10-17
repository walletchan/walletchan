import { getAccounts } from "../accountStorage";
import { WALLET_SECRET_OPERATION_LOCK_KEY, withStorageLock } from "../storageLock";
import { captureBunkerAccess } from "./access";
import { assertBunkerDraftId } from "./record";
import { readBunkerState, writeBunkerState } from "./stateRepository";

/** Public acknowledgment only. Phrase release still requires an explicit master password. */
export async function confirmBunkerBackup(id: string) {
  assertBunkerDraftId(id);
  const current = captureBunkerAccess(true); current();
  await withStorageLock(WALLET_SECRET_OPERATION_LOCK_KEY, async () => {
    const state = await readBunkerState(id, current());
    if (!state || state.archived) throw new Error("Bunker is unavailable");
    const accounts = await getAccounts();
    state.backupConfirmed = true;
    const next = accounts.map((account) => {
      if (account.type !== "safeBunker" || account.seedVaultId !== id) return account;
      const backedUp = { ...account };
      delete backedUp.backupPending;
      return backedUp;
    });
    await writeBunkerState(state, current, { accounts: next });
    current();
    chrome.runtime.sendMessage({ type: "accountsUpdated" }).catch(() => {});
  });
  return { success: true as const };
}
