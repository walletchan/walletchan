import type { BunkerOperation } from "./types";

/** Bounded round-robin, with submitted operations first on the initial pass.
 * Persist the last ID before RPC work so a failing provider cannot starve peers. */
export function bunkerReconciliationPage(operations: BunkerOperation[], ownerIndex: number, after?: string): BunkerOperation[] {
  const outstanding = operations.filter(op => op.signature && !["confirmed", "reverted", "invalidated"].includes(op.state));
  const candidates = [...outstanding.filter(op => op.outer || op.userOperationHash),
    ...outstanding.filter(op => !op.outer && !op.userOperationHash),
    ...operations.filter(op => op.state === "reverted" && !op.userOperationHash && op.review?.ownerIndex === ownerIndex).reverse()];
  const start = after ? candidates.findIndex(op => op.id === after) + 1 : 0;
  return Array.from({ length: Math.min(5, candidates.length) }, (_, i) => candidates[(start + i) % candidates.length]);
}
