import { numberToHex } from "viem";
import { getUserOperationMaxGas } from "../feePayment/paymaster";
import type { PackedUserOperationV07, UserOperationGasEstimate } from "../feePayment/pimlicoTypes";
import { BunkerGasEstimateError } from "./errors";

// postOp is paymaster-authorized (ERC-7677), rather than wallet-estimated.
export const BUNKER_ESTIMATED_GAS_FIELDS = ["callGasLimit", "verificationGasLimit", "preVerificationGas", "paymasterVerificationGasLimit"] as const;
export function bufferBunkerGasEstimate(estimate: UserOperationGasEstimate, hasPaymaster: boolean): UserOperationGasEstimate {
  const gas = { ...estimate };
  if (!hasPaymaster) { delete gas.paymasterVerificationGasLimit; delete gas.paymasterPostOpGasLimit; }
  for (const key of BUNKER_ESTIMATED_GAS_FIELDS) {
    if (gas[key] !== undefined) gas[key] = numberToHex(BigInt(gas[key]) * 125n / 100n + 10000n);
  }
  const total = BUNKER_ESTIMATED_GAS_FIELDS.reduce((sum, key) => sum + BigInt(gas[key] ?? "0x0"), BigInt(gas.paymasterPostOpGasLimit ?? "0x0"));
  if (total > 10000000n) throw new Error("Gas limit cannot cover this execution");
  return gas;
}
export function assertBunkerGasWithinReview(operation: PackedUserOperationV07, estimate: UserOperationGasEstimate) {
  if (getUserOperationMaxGas(operation) > 10000000n) throw new Error("Gas limit cannot cover this execution");
  for (const key of BUNKER_ESTIMATED_GAS_FIELDS) {
    const required = BigInt(estimate[key] ?? "0x0"), reviewed = BigInt(operation[key] ?? "0x0");
    if (required > reviewed) throw new BunkerGasEstimateError(key, required, reviewed);
  }
}
