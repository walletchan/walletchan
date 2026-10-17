import { WALLET_SECRET_OPERATION_LOCK_KEY, withStorageLock } from "../storageLock";
import { readBunkerState, writeBunkerState } from "./stateRepository";
import type { BunkerAccess } from "./access";
import { toHex, type Hex, type TransactionReceipt } from "viem";
import { writeResultToStorage } from "../transactions/runtime";
import { saveBundleStatus, getBundleStatus, updateBundleStatus } from "../bundleStatusStorage";
import { BUNDLE_STATUS } from "../erc5792Types";
import { updateTxInHistory } from "../txHistoryStorage";
import { ensureBunkerHistory } from "./history";
import type { BunkerOperation, BunkerState } from "./types";

export async function publishBunkerRoutes(state: BunkerState, op: BunkerOperation, stage: "submitted" | "confirmed" | "rejected", receipt?: TransactionReceipt) {
  const hash = op.receipt?.hash ?? op.outer?.hash;
  for (const route of op.routes) {
    if (route.kind === "batch") {
      if (stage === "rejected" && !op.resultPublished && !await getBundleStatus(route.requestId)) {
        await writeResultToStorage(`batchTxAck:${route.requestId}`, { success: false, error: "User rejected Bunker transaction", code: 4001 });
      } else if (stage === "rejected") {
        await updateBundleStatus(route.requestId, { status: BUNDLE_STATUS.OFFCHAIN_FAILURE, error: "Bunker intent invalidated by owner recovery", completedAt: Date.now() });
      } else {
        if (!await getBundleStatus(route.requestId)) await saveBundleStatus({ id: route.requestId, chainId: 11155111, status: BUNDLE_STATUS.PENDING, atomic: true, createdAt: op.createdAt,
          origin: route.origin, ...(route.topic && route.remoteId !== undefined ? { walletConnect: { topic: route.topic, requestId: route.remoteId, method: "wallet_sendCalls" } } : {}) });
        if (!op.resultPublished) await writeResultToStorage(`batchTxAck:${route.requestId}`, { success: true, id: route.requestId });
        await updateBundleStatus(route.requestId, { txHash: hash, ...(stage === "confirmed" ? { status: BUNDLE_STATUS.CONFIRMED, completedAt: Date.now(), ...(receipt ? { receipts: [{ status: "0x1" as const, transactionHash: receipt.transactionHash,
          blockHash: receipt.blockHash, blockNumber: toHex(receipt.blockNumber), gasUsed: toHex(receipt.gasUsed), logs: receipt.logs.map((l) => ({ address: l.address as Hex, topics: [...l.topics], data: l.data })) }] } : {}) } : {}) });
      }
    } else if (route.kind !== "wallet" && !op.resultPublished) {
      await writeResultToStorage(`txResult:${route.requestId}`, stage === "rejected"
        ? { success: false, error: "User rejected Bunker transaction", code: 4001 }
        : { success: true, txHash: hash });
    }
  }
  op.resultPublished = true;
  if (hash && stage === "rejected" && op.signature) await updateTxInHistory(`bunker:${state.accountId}:${op.id}`, { status: "dropped", completedAt: Date.now() });
  if (hash && stage !== "rejected") await ensureBunkerHistory(state, op);
}

/** Rejection is already durable. Deliver outside locks; merge the receipt into fresh state. */
export async function publishBunkerRejection(id: string, requestId: string, current: BunkerAccess) {
  const snapshot = await readBunkerState(id, current());
  const operation = snapshot?.operations.find((op) => op.id === requestId);
  if (!snapshot || !operation || operation.state !== "rejected" || operation.signature || operation.resultPublished) return;
  current(); await publishBunkerRoutes(snapshot, operation, "rejected");
  await withStorageLock(`bunker:${id}`, () => withStorageLock(WALLET_SECRET_OPERATION_LOCK_KEY, async () => {
    const state = await readBunkerState(id, current());
    const op = state?.operations.find((item) => item.id === requestId);
    if (!state || !op || op.state !== "rejected" || op.signature || op.resultPublished) return;
    op.resultPublished = true; op.published = true; current(); await writeBunkerState(state, current);
  }));
}
export async function flushBunkerRejections(id: string, current: BunkerAccess) {
  const state = await readBunkerState(id, current());
  if (!state || state.archived) return;
  for (const op of state.operations.filter((item) => item.state === "rejected" && !item.signature && !item.resultPublished)) {
    await publishBunkerRejection(id, op.id, current);
  }
}
