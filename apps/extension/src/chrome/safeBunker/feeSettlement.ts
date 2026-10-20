import { decodeEventLog, numberToHex, type Hex, type PublicClient } from "viem";
import { ENTRY_POINT_V07 } from "../feePayment/constants";
import { USER_OPERATION_EVENT_ABI } from "../feePayment/userOperationEvent";
import { verifyUserOperationReceiptOnchain } from "../feePayment/receiptValidation";
import { bunkerPimlico } from "./feePayment";
import type { BunkerOperation, BunkerState } from "./types";

/** Read-only: a bundler hint must resolve to an independently fetched canonical receipt. */
export async function bunkerUserOperationReceipt(state: BunkerState, op: BunkerOperation, client: PublicClient) {
  if (!op.userOperationHash) return null;
  let hint = await bunkerPimlico(state.chainId).getUserOperationReceipt(op.userOperationHash).catch(() => null);
  if (!hint) {
    // Receipt services can forget or fail after accepting a release. Resolve the
    // exact indexed EntryPoint event directly, then independently fetch its receipt.
    const fromBlock = BigInt(op.scanBlock ?? state.plan.fromBlock);
    const head = await client.getBlockNumber();
    if (fromBlock > head) return null;
    const logs = await client.getLogs({ address: ENTRY_POINT_V07, event: USER_OPERATION_EVENT_ABI[0],
      args: { userOpHash: op.userOperationHash, sender: state.plan.address }, fromBlock,
      toBlock: head < fromBlock + 9999n ? head : fromBlock + 9999n, strict: true });
    const found = logs.find(log => log.args.userOpHash?.toLowerCase() === op.userOperationHash!.toLowerCase() &&
      log.args.sender?.toLowerCase() === state.plan.address.toLowerCase() && !log.removed);
    if (!found) return null;
    hint = { userOpHash: op.userOperationHash, sender: state.plan.address, nonce: numberToHex(found.args.nonce),
      success: found.args.success, actualGasCost: numberToHex(found.args.actualGasCost), actualGasUsed: numberToHex(found.args.actualGasUsed),
      receipt: { transactionHash: found.transactionHash } };
  }
  const verified = await verifyUserOperationReceiptOnchain({ chainId: state.chainId, sender: state.plan.address, userOperationHash: op.userOperationHash, bundlerReceipt: hint,
    fetchReceipt: async hash => ({ receipt: await client.getTransactionReceipt({ hash: hash as Hex }) } as never) });
  if (!verified || verified.paymaster.toLowerCase() !== (op.review?.feePayment?.userOperation.paymaster ?? "0x0000000000000000000000000000000000000000").toLowerCase()) throw new Error("Bunker receipt changed");
  const receipt = await client.getTransactionReceipt({ hash: verified.txHash });
  // Scope owner-change evidence to this operation, even if a bundle contains
  // other UserOperations for the same Safe. UserOperationEvent ends each segment.
  let start = 0;
  for (let i = 0; i < receipt.logs.length; i++) {
    const log = receipt.logs[i];
    if (log.address.toLowerCase() !== ENTRY_POINT_V07.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: USER_OPERATION_EVENT_ABI, data: log.data, topics: log.topics });
      if (decoded.args.userOpHash.toLowerCase() === op.userOperationHash.toLowerCase()) {
        if (decoded.args.nonce !== BigInt(op.review!.feePayment!.userOperation.nonce)) throw new Error("Bunker receipt nonce changed");
        return { receipt, success: verified.success, logs: receipt.logs.slice(start, i), actualGasCost: decoded.args.actualGasCost, actualGasUsed: decoded.args.actualGasUsed };
      }
      start = i + 1;
    } catch (error) { if (error instanceof Error && error.message === "Bunker receipt nonce changed") throw error; }
  }
  return null;
}
