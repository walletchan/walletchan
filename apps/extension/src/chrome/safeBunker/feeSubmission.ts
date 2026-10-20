import { PimlicoRpcError } from "../feePayment/pimlicoClient";
import type { Hex, PackedUserOperationV07 } from "../feePayment/pimlicoTypes";

export class BunkerSubmissionError extends Error {
  constructor(readonly diagnostic: string) { super(diagnostic); }
}

/** Never reflect remote text, URLs, signed operations, or provider error.data. */
export function bunkerSubmissionMessage(error: unknown): string {
  if (error instanceof PimlicoRpcError) {
    const status = error.httpStatus;
    const code = error.code;
    const details = [
      Number.isInteger(status) && status! >= 100 && status! <= 599 ? `HTTP ${status}` : null,
      Number.isInteger(code) && code! >= -32768 && code! <= -32000 ? `RPC ${code}` : null,
      /\bAA[0-9]{2}\b/.exec(error.message.slice(0, 4096))?.[0],
    ].filter(Boolean).join(", ");
    if (details) return `Gas service did not acknowledge submission (${details}). Check status before retrying.`;
  }
  return "Gas service did not acknowledge submission. Check status before retrying.";
}

/** One release attempt only. Even an explicit rejection can follow a prior
 * signed simulation, so preserve the hash/signature until receipt or expiry proof. */
export async function submitBunkerUserOperation(provider: { sendUserOperation(op: PackedUserOperationV07): Promise<Hex> }, operation: PackedUserOperationV07, expectedHash: Hex) {
  try {
    const returned = await provider.sendUserOperation(operation);
    return returned.toLowerCase() === expectedHash.toLowerCase()
      ? { accepted: true as const }
      : { accepted: false as const, error: "Gas service returned an unexpected operation hash. Check status before retrying." };
  } catch (error) { return { accepted: false as const, error: bunkerSubmissionMessage(error) }; }
}
