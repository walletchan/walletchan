import type { BunkerOperationStatus } from "./types";

type RequestState = { state: BunkerOperationStatus; outer?: unknown; txHash?: string };
/** A submitted execution is tracked in Activity, never in the approval queue. */
export function isBunkerApprovalPending(operation: RequestState): boolean {
  return ["queued", "reviewed", "signed", "ambiguous"].includes(operation.state) && !operation.outer && !operation.txHash;
}
export function isBunkerExecutionInFlight(operation: RequestState): boolean {
  return ["signed", "pending", "ambiguous"].includes(operation.state) && !!(operation.outer || operation.txHash);
}
