import { concatHex, encodeFunctionData, hashTypedData, parseAbi, toHex, type Hex } from "viem";
import { getSafeOpTypedData } from "@walletchan/shared/safe4337";
import type { PackedUserOperationV07 } from "../feePayment/pimlicoTypes";
import type { FeePaymentCall } from "../feePayment/userOperation";
import { encodeMultiSendTransactions } from "../safe/multiSend";
import { BUNKER_PINS } from "./network";

export function safeOperationSignature(signature: Hex, validUntil: number): Hex {
  return concatHex([toHex(0, { size: 6 }), toHex(validUntil, { size: 6 }), signature]);
}
// Public-key-1 signature of an estimation-only hash: realistic non-zero bytes
// avoid underpricing compressed L1 calldata on L2s. The validity prefix has the
// same length as the final Safe signature. It grants no Bunker owner authority.
export const SAFE_STUB_SIGNATURE = safeOperationSignature("0x8f9732acf09859d5bc5701fda5cbf9c2aeaf1530e31d79d710ec8a287401f51448d6669b8f46cc738b5577098b61287809f1eecd0cd039ec387af409f85893aa1c", 0xffffffffffff);
export function encodeBunkerUserOperationCalls(calls: readonly FeePaymentCall[]): Hex {
  const data = encodeFunctionData({ abi: parseAbi(["function multiSend(bytes transactions) payable"]), functionName: "multiSend",
    args: [encodeMultiSendTransactions(calls.map(c => ({ to: c.to, value: (c.value ?? 0n).toString() as `${bigint}`, data: c.data ?? "0x", operation: 0 as const })))] });
  return encodeFunctionData({ abi: parseAbi(["function executeUserOp(address to,uint256 value,bytes data,uint8 operation)"]), functionName: "executeUserOp", args: [BUNKER_PINS.multiSend.address as Hex, 0n, data, 1] });
}
export const bunkerSafeOpTypedData = getSafeOpTypedData;
export const bunkerSafeOpHash = (op: PackedUserOperationV07, chainId: number, validUntil: number) => hashTypedData(bunkerSafeOpTypedData(op, chainId, validUntil));
