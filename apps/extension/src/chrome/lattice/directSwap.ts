import { getAccountById } from "../accountStorage";
import { attachClearSignedMetaToHistory } from "../clearSignedMetaSnapshot";
import { getNextNonce, resetNonce } from "../forceInclusion/nonceManager";
import { applyReceiptToHistory, startReceiptPolling } from "../forceInclusion/receiptPoller";
import { ensureLatticeSigningSession } from "./session";
import { signAndBroadcastLatticeTransaction } from "./signing";
import { pinnedTxRequest } from "../requests/pinnedRequest";
import type { LatticeAccount } from "../types";
import { addTxToHistory, updateTxInHistory } from "../txHistoryStorage";
import { getStoredResolvedChainById } from "@/lib/chains";
import type {
  SwapExecutionResult,
  SwapGasOverride,
  SwapTxEntry,
} from "../transactions/swaps/types";

/** Twin of transactions/swaps/ledgerDirect.ts: ordered calls, one Lattice approval per leg. */
export async function executeLatticeSwap(
  transactions: SwapTxEntry[],
  chainName: string,
  account: LatticeAccount,
  gasEstimates?: SwapGasOverride[],
): Promise<SwapExecutionResult> {
  await ensureLatticeSigningSession("");
  const txIds: string[] = [];

  for (let index = 0; index < transactions.length; index += 1) {
    const entry = transactions[index];
    const txId = crypto.randomUUID();
    txIds.push(txId);
    const pending = pinnedTxRequest(account, {
      id: txId,
      tx: entry.tx,
      origin: entry.origin,
      favicon: entry.favicon,
      chainName,
      timestamp: Date.now(),
      trustedInternal: true,
    });
    const nonce = await getNextNonce(account.address, entry.tx.chainId);
    const gasOverride = gasEstimates?.[index];
    let committed = false;

    try {
      const result = await signAndBroadcastLatticeTransaction({
        opId: txId,
        account,
        tx: { ...entry.tx, nonce },
        gasOverrides: gasOverride,
        beforeBroadcast: async () => {
          const latest = await getAccountById(account.id);
          if (
            !latest ||
            latest.type !== "lattice" ||
            latest.address.toLowerCase() !== account.address.toLowerCase() ||
            latest.deviceId !== account.deviceId ||
            latest.hdPath !== account.hdPath
          ) {
            throw new Error("Prepared transaction account is no longer available");
          }

          const txForHistory = gasOverride
            ? {
                ...entry.tx,
                nonce,
                gas: gasOverride.gasLimit,
                gasPrice: undefined,
                maxFeePerGas: gasOverride.maxFeePerGas,
                maxPriorityFeePerGas: gasOverride.maxPriorityFeePerGas,
              }
            : { ...entry.tx, nonce };
          await addTxToHistory({
            id: txId,
            status: "processing",
            tx: txForHistory,
            origin: entry.origin,
            favicon: entry.favicon,
            chainName,
            chainId: entry.tx.chainId,
            createdAt: pending.timestamp,
            accountType: "lattice",
            functionName: entry.functionName,
            swapMeta: entry.swapMeta,
            bridge: entry.bridge,
            accountId: account.id,
          });
          void attachClearSignedMetaToHistory(
            txId,
            { ...entry.tx, to: entry.tx.to ?? undefined },
            entry.tx.chainId,
          );
          committed = true;
        },
      });

      const resolved = await getStoredResolvedChainById(entry.tx.chainId);
      if (result.txHash && result.receipt) {
        await applyReceiptToHistory(
          txId,
          result.txHash,
          entry.tx.chainId,
          result.receipt,
          { rpcUrl: resolved?.rpcUrl, signedGasLimit: result.signedGasLimit },
        );
      } else {
        await updateTxInHistory(txId, {
          status: "pending",
          txHash: result.txHash,
          broadcastUncertain: result.broadcastUncertain === true,
        });
        if (result.txHash) startReceiptPolling(txId, result.txHash, entry.tx.chainId);
      }

      if (result.broadcastUncertain) {
        return { success: true, txIds };
      }
    } catch (error) {
      resetNonce(account.address, entry.tx.chainId);
      const message = error instanceof Error ? error.message : "Lattice transaction failed";
      if (committed) {
        await updateTxInHistory(txId, {
          status: "failed",
          error: message,
          completedAt: Date.now(),
        });
      }
      return {
        success: index > 0,
        txIds,
        error: `Transaction ${index + 1}/${transactions.length} failed: ${message}`,
      };
    }
  }

  return { success: true, txIds };
}
