import type { Account } from "../types";
import { isSafeExecutorAccount } from "../safe/accountTypePolicy";

/** A saved payer is usable only while both its identity and signing capability survive. */
export function isBunkerPayerAvailable(payer: { id: string; address: string }, bunker: { accountId: string; address: string }, accounts: Account[]) {
  return payer.id === bunker.accountId && payer.address.toLowerCase() === bunker.address.toLowerCase() ||
    accounts.some(account => account.id === payer.id && account.address.toLowerCase() === payer.address.toLowerCase() && isSafeExecutorAccount(account));
}
