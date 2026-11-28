/** Public diagnostics never include endpoint URLs, payloads, or remote error text. */
const MESSAGES = {
  unavailable: "The selected RPC is unavailable. Retry or change the RPC in Network settings.",
  timeout: "The selected RPC timed out. Retry or change the RPC in Network settings.",
  rateLimit: "The selected RPC is rate limiting requests. Wait and retry, or change the RPC in Network settings.",
  access: "The selected RPC denied access. Check its API key or change the RPC in Network settings.",
  unsupported: "The selected RPC does not support a required method. Change the RPC in Network settings.",
  blockHeight: "The selected RPC could not provide the latest block number using eth_blockNumber or eth_getBlockByNumber. Retry or change the RPC in Network settings.",
  invalid: "The selected RPC returned an invalid response. Retry or change the RPC in Network settings.",
} as const;
export type RpcFailureReason = keyof typeof MESSAGES;

export class RpcEndpointError extends Error {
  constructor(readonly reason: RpcFailureReason) {
    super(MESSAGES[reason]);
    this.name = "RpcEndpointError";
  }
}

/** Inspect only structured metadata in a bounded cause chain, never remote text. */
export function rpcFailureReason(error: unknown): RpcFailureReason | null {
  let current = error;
  let fallback: RpcFailureReason | null = null;
  for (let depth = 0; depth < 10 && current && typeof current === "object"; depth++) {
    if (current instanceof RpcEndpointError) return current.reason;
    const item = current as { name?: unknown; code?: unknown; status?: unknown; cause?: unknown };
    if (item.status === 429 || item.code === -32005) return "rateLimit";
    if (item.status === 401 || item.status === 403) return "access";
    if (item.code === -32601 || item.code === -32004) return "unsupported";
    if (item.name === "HttpRequestTimeoutError" || item.name === "TimeoutError") return "timeout";
    if (item.code === -32700 || item.name === "HttpResponseTooLargeError") return "invalid";
    if (item.name === "HttpRequestError") fallback = "unavailable";
    current = item.cause;
  }
  return fallback;
}

export function rpcFailureMessage(error: unknown): string | null {
  const reason = rpcFailureReason(error);
  return reason ? MESSAGES[reason] : null;
}
