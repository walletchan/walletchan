import type { SafeBunkerAccount } from "../types";
import type { SafeCall } from "../safe/types";
import { normalizeTransactionValue } from "../transactionValidation";
export function normalizeBunkerIngressTransaction(account: SafeBunkerAccount, tx: any): SafeCall[] {
  if (Number(tx.chainId) !== account.chainId || tx.from && tx.from.toLowerCase() !== account.address.toLowerCase()) throw new Error("Bunker chain or sender mismatch");
  if (!tx.to || tx.authorizationList !== undefined || tx.type === "0x4") throw new Error("Bunker contract creation and EOA authorization are unsupported");
  const value = normalizeTransactionValue(tx.value); if (!value.ok) throw new Error(value.error);
  return [{ to: tx.to, value: BigInt(value.value).toString() as `${bigint}`, data: tx.data || "0x", operation: 0 }];
}
