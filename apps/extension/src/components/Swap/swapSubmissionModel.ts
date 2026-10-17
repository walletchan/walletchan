import type { SwapAccountType } from "./swapViewTypes";
import { hasAccountTypeCapability } from "@/chrome/hardware/accountCapabilities";

export type SwapSubmissionKind =
  | "walletExecution"
  | "safeProposal"
  | "unsupported";

/**
 * Safe swaps become reviewed Safe proposals. Cross-chain Safe bridges stay
 * guarded until the receiver Safe is verified on the destination network.
 */
export function getSwapSubmissionKind(
  accountType: SwapAccountType,
  isBridge: boolean,
): SwapSubmissionKind {
  if (!hasAccountTypeCapability(accountType, "directSwap")) {
    return "unsupported";
  }
  if (accountType === "safe") {
    return isBridge ? "unsupported" : "safeProposal";
  }
  return "walletExecution";
}
