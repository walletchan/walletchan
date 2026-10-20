import type { CompletedTransaction } from "./types";
import { isWalletOuterGasPayer } from "./nativeDelta";

/** Shared by initial receipt enrichment and detail backfill for the observed account. */
export function isHistoryOuterGasPayer(
  tx: Pick<CompletedTransaction, "tx" | "safeBunkerMeta" | "safeDeploymentMeta" | "feePaymentToken" | "erc20FeePayment">,
): boolean {
  const isDeploymentSafe = !!tx.safeDeploymentMeta &&
    tx.tx.from.toLowerCase() === tx.safeDeploymentMeta.safeAddress.toLowerCase();
  return !tx.safeBunkerMeta && !isDeploymentSafe &&
    isWalletOuterGasPayer(tx.feePaymentToken, tx.erc20FeePayment);
}
