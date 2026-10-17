import { encodeFunctionData, getAddress, parseAbi, zeroAddress, type Hex } from "viem";
import { encodeMultiSendTransactions } from "../safe/multiSend";
import { computeSafeTransactionHash } from "../safe/transactionHash";
import { buildSafeTransaction } from "../safe/transactionBuilder";
import type { SafeCall, SafeTransactionData } from "../safe/types";
import { BUNKER_CHAIN_ID, BUNKER_PINS } from "./network";

export const BUNKER_EXEC_ABI = parseAbi(["function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns(bool)"]);
export function bunkerExecutionData(tx: SafeTransactionData, signature: Hex): Hex {
  return encodeFunctionData({ abi: BUNKER_EXEC_ABI, functionName: "execTransaction", args: [tx.to, BigInt(tx.value), tx.data,
    tx.operation, BigInt(tx.safeTxGas), BigInt(tx.baseGas), BigInt(tx.gasPrice), tx.gasToken, tx.refundReceiver, signature] });
}
export function bunkerPreviewSignature(owner: Hex): Hex { return `0x${owner.slice(2).padStart(64, "0")}${"0".repeat(64)}01`; }
export function buildBunkerTransaction(safe: Hex, nonce: bigint, owner: Hex, next: Hex, calls: SafeCall[], recovery = false) {
  if ((!calls.length && !recovery) || calls.length > 99 || owner === next) throw new Error("Invalid Bunker calls");
  const protectedTargets = [zeroAddress, safe, owner, next, ...[BUNKER_PINS.factory, BUNKER_PINS.singleton, BUNKER_PINS.multiSend].map((p) => p.address.toLowerCase())];
  const normalized = calls.map((c) => {
    const to = getAddress(c.to).toLowerCase() as Hex;
    if (c.operation !== 0 || protectedTargets.includes(to)) throw new Error("Bunker call targets protected authority");
    if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(c.data) || !/^(0|[1-9][0-9]{0,77})$/.test(c.value) || BigInt(c.value) >= 2n ** 256n) throw new Error("Invalid Bunker call");
    return { to, value: c.value, data: c.data.toLowerCase() as Hex, operation: 0 as const };
  });
  const rotation: SafeCall = { to: safe, value: "0", operation: 0, data: encodeFunctionData({
    abi: parseAbi(["function swapOwner(address prevOwner,address oldOwner,address newOwner)"]), functionName: "swapOwner",
    args: ["0x0000000000000000000000000000000000000001", owner, next] }) };
  const built = buildSafeTransaction({ chainId: BUNKER_CHAIN_ID, safeAddress: safe, safeVersion: "1.4.1", nonce, calls: [...normalized, rotation] });
  // Bunker pins CALL-only MultiSend; the general Safe builder uses MultiSend.
  if (built.calls.length > 1) {
    built.transaction.to = BUNKER_PINS.multiSend.address.toLowerCase() as Hex;
    built.transaction.data = encodeFunctionData({ abi: parseAbi(["function multiSend(bytes transactions) payable"]), functionName: "multiSend", args: [encodeMultiSendTransactions(built.calls)] });
    built.safeTxHash = computeSafeTransactionHash({ chainId: BUNKER_CHAIN_ID, safeAddress: safe, safeVersion: "1.4.1", transaction: built.transaction });
  }
  return { ...built, userCalls: normalized };
}
