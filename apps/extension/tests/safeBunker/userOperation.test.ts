import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, parseAbi, type Hex } from "viem";
import { encodeBunkerUserOperationCalls, SAFE_STUB_SIGNATURE } from "../../src/chrome/safeBunker/userOperation";
import { decodeMultiSendTransactions } from "../../src/chrome/safe/multiSend";
import { prepareTokenUserOperation } from "../../src/chrome/feePayment/prepareUserOperation";
import { buildBunkerTransaction } from "../../src/chrome/safeBunker/transaction";
import { BUNKER_PINS } from "../../src/chrome/safeBunker/network";
const safe = `0x${"11".repeat(20)}` as Hex, owner = `0x${"22".repeat(20)}` as Hex, next = `0x${"33".repeat(20)}` as Hex;
const token = `0x${"44".repeat(20)}` as Hex, paymaster = `0x${"55".repeat(20)}` as Hex;
for (const currentAllowance of [0n, 1n]) test(`Safe ERC-20 preparation preserves bounded approvals, reset=${currentAllowance > 0n}, and final rotation`, async () => {
  const built = buildBunkerTransaction(safe, 0n, owner, next, [{ to: token, value: "0", data: "0x1234", operation: 0 }], false, 8453);
  let quotes = 0;
  const provider = {
    async getTokenQuotes(requested: Hex[]) { quotes++; assert.deepEqual(requested, [token]); return [{ token, paymaster, postOpGas: "0x64", exchangeRate: "0xde0b6b3a7640000", exchangeRateNativeToUsd: "0x1", balanceSlot: "0x0", allowanceSlot: "0x0" }] as any; },
    async getUserOperationGasPrice() { return { standard: { maxFeePerGas: "0x64", maxPriorityFeePerGas: "0x1" } } as any; },
    async getPaymasterStubData() { return { paymaster, paymasterData: "0x01", paymasterVerificationGasLimit: "0x64", paymasterPostOpGasLimit: "0x64" } as const; },
    async getPaymasterData() { return { paymaster, paymasterData: "0x02", paymasterVerificationGasLimit: "0x64", paymasterPostOpGasLimit: "0x64" } as const; },
    async estimateUserOperationGas() { return { callGasLimit: "0x1000", verificationGasLimit: "0x1000", preVerificationGas: "0x1000" } as const; },
  };
  const prepared = await prepareTokenUserOperation(provider, { sender: safe, nonce: "0x0", token, maximumGasCost: 100000000n, currentAllowance,
    calls: built.calls.map(c => ({ to: c.to, value: BigInt(c.value), data: c.data })), encodeCalls: encodeBunkerUserOperationCalls, stubSignature: SAFE_STUB_SIGNATURE });
  assert.equal(quotes, 1, "only selected token is quoted");
  assert.equal(prepared.userOperation.signature, SAFE_STUB_SIGNATURE);
  assert.equal(prepared.approvalAmount, prepared.maximumTokenCost);
  assert.equal(prepared.userOperation.eip7702Auth, undefined);
  const outer = decodeFunctionData({ abi: parseAbi(["function executeUserOp(address to,uint256 value,bytes data,uint8 operation)"]), data: prepared.userOperation.callData });
  assert.equal(outer.args[0].toLowerCase(), BUNKER_PINS.multiSend.address.toLowerCase());
  assert.equal(outer.args[3], 1);
  const inner = decodeFunctionData({ abi: parseAbi(["function multiSend(bytes transactions)"]), data: outer.args[2] });
  const calls = decodeMultiSendTransactions(inner.args[0]);
  assert.equal(calls.length, currentAllowance > 0n ? 4 : 3);
  if (currentAllowance > 0n) { const reset = decodeFunctionData({ abi: parseAbi(["function approve(address spender,uint256 value)"]), data: calls.shift()!.data }); assert.equal(reset.args[1], 0n); }
  const approval = decodeFunctionData({ abi: parseAbi(["function approve(address spender,uint256 value)"]), data: calls[0].data });
  assert.equal(approval.args[0].toLowerCase(), paymaster);
  assert.equal(approval.args[1], prepared.maximumTokenCost);
  assert.equal(calls[1].data, "0x1234");
  const rotation = decodeFunctionData({ abi: parseAbi(["function swapOwner(address prevOwner,address oldOwner,address newOwner)"]), data: calls[2].data });
  assert.equal(rotation.args[2].toLowerCase(), next);
});
