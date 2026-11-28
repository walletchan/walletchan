import type { BunkerOperation, BunkerState } from "./types";

export const BUNKER_JOURNAL_MAX_BYTES = 512 * 1024;
const RECOVERY_HEADROOM = 32 * 1024;
const encoder = new TextEncoder();
const size = (state: BunkerState) => encoder.encode(JSON.stringify(state)).length;

/** Reserve space before releasing an owner signature, including its future EOA envelope. */
function requiredBytes(state: BunkerState, reserve: boolean): number {
  const recovery = reserve ? RECOVERY_HEADROOM + encoder.encode(JSON.stringify(state.usedOwners)).length : 0;
  return size(state) + recovery + state.operations.reduce((bytes, op) =>
    bytes + (op.review && !op.review.feePayment && !op.outer && ["reviewed", "signed"].includes(op.state)
      ? op.review.transaction.data.length + 4096 : 0), 0);
}

function removable(op: BunkerOperation, ownerIndex: number): boolean {
  if (op.state === "rejected") return !op.signature && op.resultPublished === true;
  if (op.state === "confirmed" || op.state === "reverted") return op.published === true;
  // An expiry proof can reorg while its owner is still current. Retain the
  // signature until an owner change makes it unusable independently of expiry.
  return op.state === "invalidated" && op.published === true &&
    (!op.signature || !!op.review && op.review.ownerIndex < ownerIndex);
}

/** Mutates a validated candidate only; callers commit the result atomically. */
export function compactBunkerJournal(state: BunkerState, reserve = false): void {
  const receipts = state.operations.filter(op => op.receipt);
  const recent = new Set(receipts.slice(-10).map(op => op.id));
  const latestReceipt = receipts.at(-1)?.id;
  const warning = [...state.operations].reverse().find(op => op.state === "reverted" && op.review?.ownerIndex === state.ownerIndex)?.id;
  const candidates = state.operations.filter(op => removable(op, state.ownerIndex) && op.id !== latestReceipt && op.id !== warning);
  const remove = (op: BunkerOperation) => { state.operations = state.operations.filter(item => item.id !== op.id); };
  // Normal count retention keeps ten receipt anchors. Under byte pressure, keep
  // the latest anchor and warning, then discard older fully published records.
  if (state.operations.length >= 90) for (const op of candidates) if (!recent.has(op.id)) remove(op);
  for (const op of [...candidates.filter(op => !recent.has(op.id)), ...candidates.filter(op => recent.has(op.id))]) {
    if (requiredBytes(state, reserve) <= BUNKER_JOURNAL_MAX_BYTES) break;
    remove(op);
  }
  // Ordinary admission/review leaves one slot for the recovery rotation too.
  if (state.operations.length > (reserve ? 99 : 100)) throw new Error("Bunker activity limit reached; archive settled activity first");
  if (requiredBytes(state, reserve) > BUNKER_JOURNAL_MAX_BYTES) throw new Error("Bunker journal limit reached");
}
