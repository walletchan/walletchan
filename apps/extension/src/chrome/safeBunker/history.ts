import { getBunkerHistoryRotation } from "./historyRotation";
import { parseTransaction } from "viem";
import { isSafeExecutorAccount } from "../safe/accountTypePolicy";
import { getAccountById } from "../accountStorage";
import { addTxToHistoryIfAbsent, updateTxInHistory, type CompletedTransaction } from "../txHistoryStorage";
import { startReceiptAssetChangeExtraction } from "../forceInclusion/receiptAssetEnrichment";
import { startReceiptPolling } from "../forceInclusion/receiptPoller";
import type { BunkerOperation, BunkerState } from "./types";

export const bunkerHistoryId = (state: BunkerState, op: BunkerOperation) => `bunker:${state.accountId}:${op.id}`;

/** Only user intent enters public Safe history. Signed bytes stay in the encrypted journal. */
export function buildBunkerHistory(state: BunkerState, op: BunkerOperation): CompletedTransaction | null {
  const hash = op.receipt?.hash ?? op.outer?.hash;
  if (!hash && !op.userOperationHash) return null;
  return {
    id: bunkerHistoryId(state, op), chainId: state.chainId, chainName: state.chainName, createdAt: op.createdAt,
    completedAt: op.receipt?.timestamp, status: op.state === "confirmed" ? "success" : op.state === "reverted" ? "failed" : op.state === "invalidated" ? "dropped" : "pending",
    origin: op.routes.map((r) => r.origin).join(", ").slice(0, 512), favicon: null,
    txHash: hash, userOperationHash: op.userOperationHash,
    ...(op.review?.feePayment && op.review.feePayment.tokenId !== "native" ? { feePaymentToken: op.review.feePayment.tokenId, erc20FeePayment: { token: op.review.feePayment.tokenId } } : {}),
    accountId: state.accountId, broadcastUncertain: op.state === "ambiguous", error: op.error,
    functionName: op.kind === "recovery" ? "Owner rotation" : undefined,
    safeBunkerMeta: { kind: op.kind, rotation: getBunkerHistoryRotation(state.plan.address, op.review), calls: op.calls.map((c) => ({ to: c.to, value: c.value, data: c.data, operation: c.operation })) },
    tx: { chainId: state.chainId, from: state.plan.address, to: op.calls[0]?.to ?? state.plan.address,
      value: op.calls.reduce((n, c) => n + BigInt(c.value), 0n).toString() },
  };
}

/** Idempotent journal projection also repairs rows written by earlier Bunker builds. */
export async function ensureBunkerHistory(state: BunkerState, op: BunkerOperation) {
  const entry = buildBunkerHistory(state, op);
  if (!entry) return;
  const stored = await addTxToHistoryIfAbsent(entry);
  if (JSON.stringify(stored.safeBunkerMeta) !== JSON.stringify(entry.safeBunkerMeta) || stored.functionName !== entry.functionName) {
    await updateTxInHistory(entry.id, { safeBunkerMeta: entry.safeBunkerMeta, functionName: entry.functionName });
  }
  if (stored.status !== entry.status || stored.txHash !== entry.txHash || stored.broadcastUncertain !== entry.broadcastUncertain || stored.error !== entry.error) {
    await updateTxInHistory(entry.id, { status: entry.status, txHash: entry.txHash, completedAt: entry.completedAt,
      broadcastUncertain: entry.broadcastUncertain, error: entry.error });
  }
  if (op.state === "confirmed" && !stored.assetChanges) void startReceiptAssetChangeExtraction(entry.id, entry.txHash!, state.chainId);
  const outer = op.outer;
  if (!outer || !op.review) return;
  const payer = await getAccountById(outer.payerId);
  if (!payer || payer.address.toLowerCase() !== outer.payerAddress.toLowerCase() || !isSafeExecutorAccount(payer)) return;
  const signed = parseTransaction(outer.raw);
  const executor: CompletedTransaction = {
    id: `bunker-executor:${state.accountId}:${op.id}:${outer.hash}`, chainId: state.chainId, chainName: state.chainName,
    createdAt: op.createdAt, origin: entry.origin || "WalletChan", favicon: null, status: "pending", txHash: outer.hash,
    accountId: payer.id, accountType: payer.type,
    functionName: `Execute Safe Tx #${op.review.nonce}`, safeExecutionMeta: { safeAddress: state.plan.address, nonce: op.review.nonce },
    broadcastUncertain: op.state === "ambiguous",
    tx: { chainId: state.chainId, from: outer.payerAddress, to: state.plan.address, value: "0", nonce: signed.nonce,
      gas: signed.gas?.toString(), maxFeePerGas: signed.maxFeePerGas?.toString(), maxPriorityFeePerGas: signed.maxPriorityFeePerGas?.toString() },
    calldataSelector: "0x6a761202",
  };
  const existing = await addTxToHistoryIfAbsent(executor);
  if (existing.status === "pending") startReceiptPolling(executor.id, outer.hash, state.chainId);
}
