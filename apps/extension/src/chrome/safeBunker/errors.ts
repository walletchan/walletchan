import { RpcEndpointError, rpcFailureMessage, rpcFailureReason } from "../network/rpcDiagnostics";

/** Fixed public diagnostics only. RPC errors may contain keys, signed calldata or URLs. */
const STEPS = {
  state: "Could not read or validate the Bunker journal",
  authorization: "Could not verify the requesting app’s connection",
  calls: "Could not prepare these Bunker calls",
  save: "Could not save the prepared Bunker review",
  authority: "Could not verify the Bunker owner and Safe configuration",
  estimate: "Could not estimate gas for this Bunker transaction",
  fees: "Could not load Sepolia gas prices",
  balance: "Could not check the gas payer or Bunker balance",
  simulation: "The exact Bunker execution could not be simulated",
} as const;
type BunkerStep = keyof typeof STEPS;

export class BunkerStepError extends Error {
  constructor(readonly step: BunkerStep) {
    super(`${STEPS[step]}. Refresh the request and retry. [${step}]`);
  }
}

export async function bunkerStep<T>(step: BunkerStep, work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) {
    const rpcReason = rpcFailureReason(error);
    if (rpcReason) throw new RpcEndpointError(rpcReason);
    if (error instanceof BunkerStepError || bunkerPolicyMessage(error)) throw error;
    throw new BunkerStepError(step);
  }
}

// Never reflect arbitrary error.message, cause, RPC data, or stack to the renderer.
export function bunkerStepMessage(error: unknown): string | null {
  return rpcFailureMessage(error) ?? (error instanceof BunkerStepError ? new BunkerStepError(error.step).message : null);
}

const POLICY_MESSAGES = new Set([
  "Authentication changed. Unlock and retry.",
  "Wallet is locked",
  "Bunker RPC is not on Sepolia",
  "Bunker Safe infrastructure could not be verified",
  "Bunker owner or nonce changed",
  "Bunker reviewed transaction changed",
  "Bunker review changed",
  "Bunker authority changed",
  "Signed Safe transaction is stale. Reconcile or recover.",
  "Check the submitted transaction before retrying",
  "Gas limit cannot cover this execution",
  "Chain reorganization detected. Recovery required.",
  "Bunker owners must be plain addresses",
  "Bunker owner address has been used as a transaction sender",
  "Bunker call targets protected authority",
  "Choose a private-key, seed-phrase or Ledger gas payer",
  "Gas payer has insufficient Sepolia ETH",
  "Bunker has insufficient native balance",
  "Review this Bunker operation again",
  "Earlier Bunker requests must settle first",
  "Waiting for the previous transaction to confirm.",
  "Resolve the current signed operation first",
  "Rotate the restored owner before spending",
  "Complete recovery scan first",
  "Bunker owner changed. Reconcile before signing.",
  "Bunker Safe configuration changed. Recovery required.",
  "Exact execution exceeds reviewed gas. Review again.",
  "Execution paused. Check operation status before retrying.",
  "Check pending deployment before retrying",
  "Wait for deployment confirmations",
  "Seed or Safe deployment does not match",
  "Use the original Safe factory deployment transaction",
  "Invalid master password",
  "Confirm seed backup and master password",
  "Browser sync is busy. Wait a minute and try again.",
  "Resolve Bunker requests before removal",
  "Safe deployment reverted. Retry with the same identity.",
  "Invalid Bunker draft record",
  "Invalid Bunker calls",
  "Invalid Bunker call",
  "Bunker operation is unavailable",
  "Bunker owner exposure is unresolved",
  "Canonical MultiSend is unavailable on this network",
  "Unsupported Safe singleton",
  "Safe is not deployed",
  "Safe proxy runtime does not match canonical deployment",
  "Safe singleton code does not match canonical deployment",
]);

export function bunkerPolicyMessage(error: unknown): string | null {
  return error instanceof Error && POLICY_MESSAGES.has(error.message) ? error.message : null;
}
