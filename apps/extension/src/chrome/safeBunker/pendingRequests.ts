import { isBunkerApprovalPending } from "./requestPolicy";
import { readBunkerInbox } from "./inbox";
import { getAccounts } from "../accountStorage";
import type { BunkerState } from "./types";

export const BUNKER_PENDING_KEY = "safeBunkerPendingV1";
export interface PendingBunkerRequest { id: string; accountId: string; createdAt: number }
/** Notification metadata only. Never authorizes or reconstructs a transaction. */
export async function readBunkerPendingIndex(): Promise<PendingBunkerRequest[]> {
  const value = (await chrome.storage.local.get(BUNKER_PENDING_KEY))[BUNKER_PENDING_KEY];
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 10000 || value.some((r) => !r ||
    Object.keys(r).some((key) => !["id", "accountId", "createdAt"].includes(key)) ||
    typeof r.id !== "string" || !r.id.length || r.id.length > 256 || typeof r.accountId !== "string" ||
    !r.accountId.length || r.accountId.length > 256 || !Number.isSafeInteger(r.createdAt) || r.createdAt < 0)) throw new Error("Invalid Bunker pending index");
  return value;
}
export function projectBunkerPending(state: BunkerState): PendingBunkerRequest[] {
  return state.activated && !state.archived ? state.operations
    .filter(isBunkerApprovalPending)
    .map((op) => ({ id: op.id, accountId: state.accountId, createdAt: op.createdAt })) : [];
}
export async function getPendingBunkerRequests(): Promise<PendingBunkerRequest[]> {
  const [index, inbox, accounts] = await Promise.all([readBunkerPendingIndex(), readBunkerInbox(), getAccounts()]);
  const eligible = new Set(accounts.filter((a) => a.type === "safeBunker").map((a) => a.id));
  const merged = new Map(index.map((r) => [r.id, r]));
  for (const entry of inbox) if (!merged.has(entry.id)) merged.set(entry.id, { id: entry.id, accountId: entry.accountId, createdAt: 0 });
  return [...merged.values()].filter((r) => eligible.has(r.accountId)).sort((a, b) => a.createdAt - b.createdAt);
}
export function notifyBunkerPendingChanged() {
  void import("../requests/pendingTxStorage").then(({ updateBadge }) => updateBadge()).catch(() => {});
}
