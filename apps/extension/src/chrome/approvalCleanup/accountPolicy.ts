export type ApprovalCleanupEoaAccountType =
  | "bankr"
  | "privateKey"
  | "seedPhrase"
  | "ledger"
  | "trezor"
  | "impersonator";

export function supportsAtomicEoaApprovalCleanup(
  accountType: unknown,
): accountType is "privateKey" | "seedPhrase" | "bankr" {
  return hasAccountTypeCapability(accountType, "approvalCleanupMutation");
}
import { hasAccountTypeCapability } from "../hardware/accountCapabilities";
