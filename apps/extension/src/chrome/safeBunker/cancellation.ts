import { getCachedVaultKey } from "../sessionCache";
import { WALLET_SECRET_OPERATION_LOCK_KEY, withStorageLock } from "../storageLock";
import { authorizeBunkerOperation } from "./authorization";
import { captureBunkerAccess } from "./access";
import { readBunkerInbox, acknowledgeBunkerInbox } from "./inbox";
import { readBunkerState, writeBunkerState } from "./stateRepository";
import { publishBunkerRoutes } from "./publication";

/** Revoked unsigned groups are rejected together; signed evidence is retained. */
export async function cancelUnauthorizedBunkerRequests(id: string) {
  if (!getCachedVaultKey()) return;
  const current = captureBunkerAccess(); current();
  await withStorageLock(`bunker:${id}`, () => withStorageLock(WALLET_SECRET_OPERATION_LOCK_KEY, async () => {
    const state = await readBunkerState(id, current()); if (!state || !state.activated || state.archived) return;
    for (const op of state.operations.filter((o) => !o.signature && ["queued", "reviewed"].includes(o.state))) {
      try { await authorizeBunkerOperation(state, op); }
      catch { current(); op.state = "rejected"; delete op.review; await writeBunkerState(state, current); await publishBunkerRoutes(state, op, "rejected"); }
    }
    for (const entry of (await readBunkerInbox()).filter((e) => e.accountId === state.accountId)) {
      try { await authorizeBunkerOperation(state, { ...entry, kind: "transaction", state: "queued", createdAt: Date.now() }); }
      catch { current(); await acknowledgeBunkerInbox(entry.id); await publishBunkerRoutes(state, { ...entry, kind: "transaction", state: "rejected", createdAt: Date.now() }, "rejected"); }
    }
  }));
}
