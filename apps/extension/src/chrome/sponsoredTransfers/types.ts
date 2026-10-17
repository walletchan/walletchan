import type { Account } from "../types";
import { getAccountTypeCapabilities } from "../hardware/accountCapabilities";
import type { SponsoredTransferIntentValidation } from "./validation";

export type SponsoredTransferSignerAccount = Exclude<
  Account,
  { type: "impersonator" | "ledger" | "trezor" | "safe" | "safeBunker" }
>;

export function isSponsoredTransferSignerAccount(
  account: Account,
): account is SponsoredTransferSignerAccount {
  return getAccountTypeCapabilities(account.type).sponsoredTransfer;
}

export type ValidSponsoredTransferIntent = Extract<
  SponsoredTransferIntentValidation,
  { valid: true }
>;

export interface SponsoredTransferHandlerResult {
  success: boolean;
  txId?: string;
  intentId?: string;
  error?: string;
  outcomeUncertain?: boolean;
  retryReady?: boolean;
}
