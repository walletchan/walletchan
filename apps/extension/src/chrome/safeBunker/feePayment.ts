import { bufferBunkerGasEstimate } from "./feeGas";
import { erc20Abi, numberToHex, parseAbi, zeroAddress, type Hex, type PublicClient } from "viem";
import { WALLETCHAN_PIMLICO_PROXY_BASE } from "@/constants/externalUrls";
import { ENTRY_POINT_V07 } from "../feePayment/constants";
import { PimlicoClient } from "../feePayment/pimlicoClient";
import { prepareTokenUserOperation } from "../feePayment/prepareUserOperation";
import { getUserOperationMaxGas, createTokenApprovalCall, createTokenApprovalResetCall } from "../feePayment/paymaster";
import { getPimlicoFeeToken, getPimlicoFeeTokens } from "../feePayment/tokens";
import { buildFundedFeePaymentTokenOptions } from "../feePayment/capabilities";
import type { FeePaymentCall } from "../feePayment/userOperation";
import type { PackedUserOperationV07 } from "../feePayment/pimlicoTypes";
import type { BunkerFeeReview, BunkerReview, BunkerState } from "./types";
import { SAFE_STUB_SIGNATURE, encodeBunkerUserOperationCalls } from "./userOperation";
import { captureBunkerAccess } from "./access";
import { stateForAccount, reviewBunkerOperation } from "./operations";
import { bunkerClient } from "./network";
import { authorizeBunkerOperation } from "./authorization";

export const bunkerPimlico = (chainId: number) => new PimlicoClient(`${WALLETCHAN_PIMLICO_PROXY_BASE}/${chainId}`, chainId);
export const bunkerEntryPointNonce = (client: PublicClient, sender: Hex) => client.readContract({ address: ENTRY_POINT_V07,
  abi: parseAbi(["function getNonce(address sender,uint192 key) view returns(uint256)"]), functionName: "getNonce", args: [sender, 0n] });
export function bunkerFeeCalls(calls: readonly FeePaymentCall[], fee: BunkerFeeReview): FeePaymentCall[] {
  return fee.approvalAdded && fee.approvalAmount && fee.userOperation.paymaster
    ? [...(fee.approvalReset ? [createTokenApprovalResetCall(fee.tokenId as Hex, fee.userOperation.paymaster)] : []), createTokenApprovalCall(fee.tokenId as Hex, fee.userOperation.paymaster, BigInt(fee.approvalAmount)), ...calls] : [...calls];
}
export async function prepareBunkerFee(state: BunkerState, calls: FeePaymentCall[], tokenId: unknown, client: PublicClient): Promise<{ fee: BunkerFeeReview; maxFee: string }> {
  const provider = bunkerPimlico(state.chainId);
  const nonce = numberToHex(await bunkerEntryPointNonce(client, state.plan.address));
  const validUntil = Math.floor(Date.now() / 1000) + 45;
  const estimateWithHeadroom = async (operation: PackedUserOperationV07, preview = false) => {
    const estimate = await provider.estimateUserOperationGas(operation, preview);
    const gas = bufferBunkerGasEstimate(estimate, !!operation.paymaster);
    return gas;
  };
  let op: PackedUserOperationV07;
  let maximumTokenCost: bigint, balance: bigint, approvalAmount: string | null = null, approvalAdded = false;
  if (tokenId === "native") {
    const prices = await provider.getUserOperationGasPrice();
    op = { sender: state.plan.address, nonce, callData: encodeBunkerUserOperationCalls(calls), callGasLimit: "0x0", verificationGasLimit: "0x0", preVerificationGas: "0x0",
      ...prices.standard, signature: SAFE_STUB_SIGNATURE };
    // Only unsigned estimation may override prefund balance. Final submission never does.
    const estimate = await estimateWithHeadroom(op, true);
    op = { ...op, ...estimate };
    maximumTokenCost = getUserOperationMaxGas(op) * BigInt(op.maxFeePerGas);
    const deposit = await client.readContract({ address: ENTRY_POINT_V07, abi: parseAbi(["function balanceOf(address account) view returns(uint256)"]), functionName: "balanceOf", args: [state.plan.address] });
    balance = await client.getBalance({ address: state.plan.address });
    const spend = calls.reduce((sum, c) => sum + (c.value ?? 0n), 0n);
    return { fee: { tokenId: "native", userOperation: op, maximumTokenCost: maximumTokenCost.toString(), tokenBalance: balance.toString(),
      sufficientBalance: balance >= spend && balance - spend + deposit >= maximumTokenCost, approvalAdded, approvalAmount, validUntil }, maxFee: maximumTokenCost.toString() };
  }
  const token = typeof tokenId === "string" ? getPimlicoFeeToken(state.chainId, tokenId) : null;
  if (!token) throw new Error("Unsupported Bunker fee token");
  let currentAllowance = 0n;
  const prepared = await prepareTokenUserOperation({ getTokenQuotes: tokens => provider.getTokenQuotes(tokens), getUserOperationGasPrice: () => provider.getUserOperationGasPrice(),
    getPaymasterStubData: (...args) => provider.getPaymasterStubData(...args), getPaymasterData: (...args) => provider.getPaymasterData(...args),
    estimateUserOperationGas: operation => estimateWithHeadroom(operation) }, { sender: state.plan.address, nonce, calls, token: token.address,
    maximumGasCost: token.maximumGasCost, encodeCalls: encodeBunkerUserOperationCalls, stubSignature: SAFE_STUB_SIGNATURE, validateFinalGas: operation => provider.estimateUserOperationGas(operation),
    getCurrentAllowance: async paymaster => { currentAllowance = await client.readContract({ address: token.address, abi: erc20Abi, functionName: "allowance", args: [state.plan.address, paymaster] }); return currentAllowance; } });
  op = prepared.userOperation; maximumTokenCost = prepared.maximumTokenCost;
  if (getUserOperationMaxGas(op) > 10000000n) throw new Error("Gas limit cannot cover this execution");
  balance = await client.readContract({ address: token.address, abi: erc20Abi, functionName: "balanceOf", args: [state.plan.address] });
  approvalAdded = prepared.approvalAdded; approvalAmount = prepared.approvalAmount?.toString() ?? null;
  return { fee: { tokenId: token.id, userOperation: op, maximumTokenCost: maximumTokenCost.toString(), tokenBalance: balance.toString(), sufficientBalance: balance >= maximumTokenCost,
    approvalReset: approvalAdded && currentAllowance > 0n, approvalAdded, approvalAmount, validUntil }, maxFee: (getUserOperationMaxGas(op) * BigInt(op.maxFeePerGas)).toString() };
}
export async function getBunkerFeePaymentOptions(accountId: string, requestId: string) {
  const current = captureBunkerAccess(); current();
  const state = await stateForAccount(accountId), op = state.operations.find(o => o.id === requestId);
  if (!op) throw new Error("Bunker operation is unavailable");
  const gate = await authorizeBunkerOperation(state, op);
  const client = await bunkerClient(state.chainId), tokens = getPimlicoFeeTokens(state.chainId);
  // Balance discovery must not depend on a successful bundler estimate. A Safe
  // with no spendable native funds can choose a funded token even if ETH quoting fails.
  const [nativeBalance, deposit, balances] = await Promise.all([
    client.getBalance({ address: state.plan.address }).catch(() => undefined),
    client.readContract({ address: ENTRY_POINT_V07, abi: parseAbi(["function balanceOf(address account) view returns(uint256)"]), functionName: "balanceOf", args: [state.plan.address] }).catch(() => undefined),
    Promise.all(tokens.map(t => client.readContract({ address: t.address, abi: erc20Abi, functionName: "balanceOf", args: [state.plan.address] }).catch(() => undefined))),
  ]);
  const spend = op.calls.reduce((sum, call) => sum + BigInt(call.value), 0n);
  gate(); current();
  return { success: true, options: [{ id: "native", symbol: client.chain?.nativeCurrency.symbol ?? "Native", decimals: 18, available: true,
    balance: nativeBalance?.toString(), insufficientBalance: nativeBalance !== undefined && deposit !== undefined && nativeBalance <= spend && deposit === 0n },
    ...buildFundedFeePaymentTokenOptions({ feeTokens: tokens, balances, eligibility: { available: true } })] };
}
export async function prepareBunkerFeePaymentQuote(accountId: string, requestId: string, tokenId: unknown) {
  const current = captureBunkerAccess(); current();
  const state = await stateForAccount(accountId);
  const op = await reviewBunkerOperation(accountId, requestId, accountId, await bunkerClient(state.chainId), undefined, tokenId);
  const review = op.review!, fee = review.feePayment!;
  const token = getPimlicoFeeToken(state.chainId, fee.tokenId)!;
  current();
  return { success: true, quoteId: review.digest, tokenId: token.id, tokenAddress: token.address, tokenSymbol: token.symbol, tokenDecimals: token.decimals,
    tokenStablecoin: token.stablecoin, maximumTokenCost: fee.maximumTokenCost, tokenBalance: fee.tokenBalance, expiresAt: review.expiresAt,
    approvalAdded: fee.approvalAdded, approvalAmount: fee.approvalAmount, paymaster: fee.userOperation.paymaster ?? zeroAddress,
    userOperationNonce: fee.userOperation.nonce, sufficientBalance: fee.sufficientBalance, needsAuthorization: false };
}
export async function assertBunkerFeeState(review: BunkerReview, client: PublicClient) {
  const fee = review.feePayment!;
  if (!fee.sufficientBalance || review.expiresAt <= Date.now()) throw new Error("Review this Bunker operation again");
  if (await bunkerEntryPointNonce(client, review.payerAddress) !== BigInt(fee.userOperation.nonce)) throw new Error("Bunker owner or nonce changed");
  if (fee.userOperation.sender.toLowerCase() !== review.payerAddress.toLowerCase() || getUserOperationMaxGas(fee.userOperation) > 10000000n) throw new Error("Review this Bunker operation again");
  if (fee.tokenId === "native" && fee.userOperation.paymaster) throw new Error("Review this Bunker operation again");
  if (fee.tokenId !== "native") {
    const chainId = client.chain?.id;
    const token = chainId ? getPimlicoFeeToken(chainId, fee.tokenId) : null;
    if (!token || !fee.userOperation.paymaster || BigInt(fee.maximumTokenCost) <= 0n || BigInt(fee.maximumTokenCost) > token.maximumGasCost ||
      fee.approvalAdded && (fee.approvalAmount === null || BigInt(fee.approvalAmount) < BigInt(fee.maximumTokenCost) || BigInt(fee.approvalAmount) > token.maximumGasCost)) throw new Error("Review this Bunker operation again");
    const balance = await client.readContract({ address: fee.tokenId as Hex, abi: erc20Abi, functionName: "balanceOf", args: [review.payerAddress] });
    if (!fee.approvalAdded) {
      const allowance = await client.readContract({ address: fee.tokenId as Hex, abi: erc20Abi, functionName: "allowance", args: [review.payerAddress, fee.userOperation.paymaster!] });
      if (allowance < BigInt(fee.maximumTokenCost)) throw new Error("Review this Bunker operation again");
    }
    if (balance < BigInt(fee.maximumTokenCost)) throw new Error("Insufficient fee-token balance for the maximum gas charge");
  }
}
