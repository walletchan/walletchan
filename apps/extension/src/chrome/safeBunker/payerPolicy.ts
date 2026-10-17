import type { Account } from "../types";
import { isSafeExecutorAccount } from "../safe/accountTypePolicy";

/** Bunker outer signing currently implements local keys and Ledger only. */
export function isBunkerPayerAccount(
  account: Account,
): account is Extract<Account, { type: "privateKey" | "seedPhrase" | "ledger" }> {
  return isSafeExecutorAccount(account) && account.type !== "trezor";
}
