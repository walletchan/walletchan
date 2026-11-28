import { isBunkerApprovalPending } from "@/chrome/safeBunker/requestPolicy";
import type { BunkerOperationSummary } from "@/chrome/safeBunker/types";

export const isPendingBunkerRequest = isBunkerApprovalPending;
export const isUnsignedBunkerRequest = (operation: BunkerOperationSummary) =>
  operation.state === "queued" || operation.state === "reviewed";

/** Background FIFO order is authoritative; a newer notification must not hide its predecessor. */
export function selectBunkerRequest(queue: BunkerOperationSummary[], requestedId: string | null, automatic: boolean) {
  queue = queue.filter(isPendingBunkerRequest);
  const requested = queue.find((operation) => operation.id === requestedId);
  if (!requestedId) return undefined;
  if (automatic && requested?.kind !== "recovery") return queue[0];
  return requestedId === "__pending__" ? queue[0] : requested;
}

export function earlierBunkerRequest(queue: BunkerOperationSummary[], operation: BunkerOperationSummary) {
  queue = queue.filter(isPendingBunkerRequest);
  return operation.kind === "transaction" && !operation.txHash && queue[0]?.id !== operation.id ? queue[0] : undefined;
}
