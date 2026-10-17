export type BunkerExecutionPhase = "signing" | "checking" | "broadcasting" | "submitted";
/** Trusted renderer hints only; no key, signature, signed bytes or RPC data. */
export function bunkerExecutionProgress(accountId: string, requestId: string, phase: BunkerExecutionPhase) {
  try { void chrome.runtime.sendMessage({ type: "safeBunkerExecutionProgress", accountId, requestId, phase }).catch(() => {}); }
  catch { /* Closing the request surface cannot interrupt execution. */ }
}
