import { runPendingRequestResolution } from "../requests/pendingRequestResolution";
/** Claim before the first await, so reset cannot race a Bunker effect. */
export function runBunkerEffect<T>(resolve: () => Promise<T>): Promise<T> {
  return runPendingRequestResolution({ family: "internalOperation", requestId: `bunker:${crypto.randomUUID()}`, action: "confirm", resolve,
    conflictResult: () => { throw new Error("Wallet reset is in progress"); } });
}
