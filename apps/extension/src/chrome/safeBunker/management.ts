import { repairSelectionAfterRemoval } from "../accounts/selectionStorage";
import { removeAccountWithDappPrivacyBoundary } from "../dapp/accountRemovalPrivacy";
import { handleRevokeDappPermission } from "../dapp/connectionHandlers";
import { getAccounts } from "../accountStorage";
import { WALLET_SECRET_OPERATION_LOCK_KEY, withStorageLock } from "../storageLock";
import { captureBunkerAccess } from "./access";
import { outstanding, stateForAccount } from "./operations";
import { writeBunkerState, loadStoredBunkerStates, readBunkerState } from "./stateRepository";
import type { BunkerAccess } from "./access";

export async function mutateBunker(accountId: string, change: (state: Awaited<ReturnType<typeof stateForAccount>>, current: BunkerAccess) => Promise<void>) {
  const current = captureBunkerAccess(); current(); const initial = await stateForAccount(accountId);
  return withStorageLock(`bunker:${initial.id}`, () => withStorageLock(WALLET_SECRET_OPERATION_LOCK_KEY, async () => {
    const state = await stateForAccount(accountId); await change(state, current); await writeBunkerState(state, current); return state;
  }));
}
export async function groupBunkerOperations(accountId: string, ids: string[]) {
  if (!Array.isArray(ids) || ids.length < 2 || new Set(ids).size !== ids.length) throw new Error("Choose distinct unsigned requests");
  return mutateBunker(accountId, async (state) => {
    const ops = ids.map((id) => state.operations.find((o) => o.id === id));
    if (ops.some((o) => !o || o.signature || o.kind !== "transaction" || !["queued", "reviewed"].includes(o.state))) throw new Error("Only unsigned requests can be grouped");
    const calls = ops.flatMap((o) => o!.calls), routes = ops.flatMap((o) => o!.routes);
    if (calls.length > 99 || routes.length > 99) throw new Error("Grouped Bunker call limit exceeded");
    state.operations = state.operations.filter((o) => !ids.includes(o.id));
    state.operations.unshift({ id: crypto.randomUUID(), kind: "transaction", calls, routes, members: ops.map((o) => ({ id: o!.id, calls: o!.calls, routes: o!.routes, createdAt: o!.createdAt })), state: "queued", createdAt: Math.min(...ops.map((o) => o!.createdAt)) });
  });
}
export async function separateBunkerOperation(accountId: string, id: string) {
  return mutateBunker(accountId, async (state) => {
    const op = state.operations.find((o) => o.id === id);
    if (!op || op.signature || op.routes.length < 2) throw new Error("Only unsigned grouped requests can be separated");
    if (!op.members) throw new Error("Group membership is missing");
    state.operations = state.operations.filter((o) => o.id !== id);
    state.operations.push(...op.members.map((m) => ({ ...m, kind: "transaction" as const, state: "queued" as const })));
    state.operations.sort((a, b) => a.createdAt - b.createdAt);
  });
}
export async function removeBunkerAccount(accountId: string, backedUp: boolean) {
  const current = captureBunkerAccess(true); current(); const initial = await stateForAccount(accountId);
  return withStorageLock(`bunker:${initial.id}`, () => withStorageLock(WALLET_SECRET_OPERATION_LOCK_KEY, async () => {
    if (!backedUp) throw new Error("Confirm seed backup");
    current();
    const state = await stateForAccount(accountId);
    if (state.operations.some((o) => outstanding(o) || ["queued", "reviewed"].includes(o.state))) throw new Error("Resolve Bunker requests before removal");
    state.archived = true;
    const accounts = await getAccounts();
    if (accounts.length <= 1) throw new Error("Cannot remove the last account");
    const remaining = accounts.filter((a) => a.id !== accountId);
    await removeAccountWithDappPrivacyBoundary({ accountId, revokeOrigin: handleRevokeDappPermission,
      removeAccount: async () => {
        current();
        // Sync can reject writes at its browser quota. Keep the account and archive
        // unchanged until selection repair succeeds; mapped sites are already disconnected.
        try { await repairSelectionAfterRemoval(accountId, remaining); }
        catch (error) {
          if (error instanceof Error && /MAX_WRITE_OPERATIONS_PER_MINUTE|MAX_WRITE_OPERATIONS_PER_HOUR/.test(error.message))
            throw new Error("Browser sync is busy. Wait a minute and try again.");
          throw error;
        }
        current(); await writeBunkerState(state, current, { accounts: remaining });
      } });
    chrome.runtime.sendMessage({ type: "accountsUpdated" }).catch(() => {});
    // Preserve encrypted seed and settlement archives. Local removal does not revoke onchain ownership.
  }));
}
export async function assertBunkerResetSafe() {
  for (const stored of await loadStoredBunkerStates()) {
    const state = await readBunkerState(stored.id);
    if (state && (!state.activated && state.plan.deploymentHash || state.operations.some(outstanding))) throw new Error("Resolve signed Bunker transactions before resetting the wallet");
  }
}
