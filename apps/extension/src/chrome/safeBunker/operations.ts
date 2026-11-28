import { decodeBunkerSwapContext, type BunkerSwapContext } from "./swapContext";
import { decodeBunkerTransferMetadata, assertBunkerNativeMax, bunkerNativeMaxAmount } from "./transferMetadata";
import { ENTRY_POINT_V07 } from "../feePayment/constants";
import { decodeBunkerSwapMetadata } from "./swapMetadata";
import type { SwapMeta, TransferMeta } from "../history/types";
import { isBunkerExecutionInFlight } from "./requestPolicy";
import { preflightBunkerExecution } from "./preflight";
import { bunkerExecutionProgress } from "./progress";
import { bunkerPolicyMessage, bunkerStepMessage } from "./errors";
import { deriveBunkerOwner } from "./derivation";
import { bunkerStep } from "./errors";
import { keccak256, stringToHex, parseAbi, formatUnits, type Hex, type PublicClient } from "viem";
import { getAccountById } from "../accountStorage";
import { WALLET_SECRET_OPERATION_LOCK_KEY, withStorageLock } from "../storageLock";
import { privateKeyToAccount } from "viem/accounts";
import { captureBunkerAccess } from "./access";
import { withBunkerDraftSeed } from "./crypto";
import { withBunkerOwnerKey } from "./derivation";
import { bunkerEntry, verifyBunkerOwner } from "./live";
import { readBunkerState, writeBunkerState } from "./stateRepository";
import { buildBunkerTransaction, bunkerExecutionData, bunkerPreviewSignature } from "./transaction";
import { authorizeBunkerOperation } from "./authorization";
import { bunkerPayer, submitBunkerOuter } from "./payer";
import { validateSafeGasOverrides } from "../safe/executionGas";
import { normalizeTransactionValue } from "../transactionValidation";
import { publishBunkerRejection, publishBunkerRoutes } from "./publication";
import type { SafeCall } from "../safe/types";
import type { GasOverrides } from "../transactions/localExecution";
import type { BunkerOperation, BunkerRoute } from "./types";
import { compactBunkerJournal } from "./journalCapacity";
import { assertBunkerCalls } from "./callValidation";
import { readBunkerInbox, rejectBunkerInboxEntry } from "./inbox";

export const outstanding = (o: BunkerOperation) => !!o.signature && !["confirmed", "reverted", "invalidated"].includes(o.state);
export async function stateForAccount(accountId: string) {
  const account = await getAccountById(accountId);
  if (!account || account.type !== "safeBunker") throw new Error("Bunker account not found");
  const state = await readBunkerState(account.bunkerId);
  if (!state || !state.activated || state.archived || state.accountId !== accountId || state.plan.address !== account.address.toLowerCase() || account.chainId !== state.chainId || account.seedGroupId !== state.seedGroupId) throw new Error("Bunker account identity changed");
  return state;
}
export async function queueBunkerOperation(input: { accountId: string; chainId: number; calls: SafeCall[]; routes: BunkerRoute[]; id?: string; recovery?: boolean; swapContext?: BunkerSwapContext; swapMeta?: SwapMeta; transferMeta?: TransferMeta; nativeMax?: { limit: string } }, options: { notifyRenderer?: boolean; fromInbox?: boolean } = {}) {
  assertBunkerCalls(input.calls, input.recovery === true);
  const swapContext = input.swapContext === undefined ? undefined : decodeBunkerSwapContext(input.swapContext);
  const swapMeta = input.swapMeta === undefined ? undefined : decodeBunkerSwapMetadata(input.swapMeta);
  if (swapContext && (!swapMeta || swapContext.sell.symbol !== swapMeta.sellTokenSymbol || swapContext.buy.symbol !== swapMeta.buyTokenSymbol)) throw new Error("Invalid Bunker swap context");
  if (swapMeta && (input.recovery || input.routes.some(route => route.kind !== "wallet"))) throw new Error("Invalid Bunker swap provenance");
  const transferMeta = input.transferMeta === undefined ? undefined : decodeBunkerTransferMetadata(input.transferMeta, input.calls);
  if (input.nativeMax !== undefined) assertBunkerNativeMax(input.nativeMax, input.calls);
  if ((transferMeta || input.nativeMax) && (input.recovery || swapMeta || input.routes.some(route => route.kind !== "wallet"))) throw new Error("Invalid Bunker transfer provenance");
  const account = await getAccountById(input.accountId); if (!account || account.type !== "safeBunker") throw new Error("Bunker account not found");
  if (input.chainId !== account.chainId) throw new Error("Bunker chain mismatch");
  // Ingress queues public calls while locked; no seed or signing capability is needed.
  return withStorageLock(`bunker:${account.bunkerId}`, () => withStorageLock(WALLET_SECRET_OPERATION_LOCK_KEY, async () => {
    const current = captureBunkerAccess(); current();
    const state = await stateForAccount(input.accountId);
    if (options.fromInbox) {
      const entry = (await readBunkerInbox()).find(e => e.id === input.id && e.accountId === input.accountId && e.chainId === input.chainId);
      if (!entry || entry.rejection || JSON.stringify(entry.calls) !== JSON.stringify(input.calls) || JSON.stringify(entry.routes) !== JSON.stringify(input.routes))
        throw new Error("Bunker inbox request is no longer pending");
    }
    const id = input.id ?? crypto.randomUUID();
    const previous = state.operations.find((o) => o.id === id);
    if (previous) {
      if (JSON.stringify(previous.calls) !== JSON.stringify(input.calls) || JSON.stringify(previous.routes) !== JSON.stringify(input.routes) || JSON.stringify(previous.swapContext) !== JSON.stringify(swapContext) || JSON.stringify(previous.swapMeta) !== JSON.stringify(swapMeta) || JSON.stringify(previous.transferMeta) !== JSON.stringify(transferMeta) || JSON.stringify(previous.nativeMax) !== JSON.stringify(input.nativeMax)) throw new Error("Bunker request identity was reused");
      return previous;
    }
    compactBunkerJournal(state, !input.recovery);
    if (state.operations.length >= 100) throw new Error("Bunker activity limit reached; archive settled activity first");
    if (input.recovery && input.calls.length) throw new Error("Recovery cannot spend funds");
    const op: BunkerOperation = { id, ...(swapContext ? { swapContext } : {}), ...(swapMeta ? { swapMeta } : {}), ...(transferMeta ? { transferMeta } : {}), ...(input.nativeMax ? { nativeMax: input.nativeMax } : {}), calls: input.calls, routes: input.routes, kind: input.recovery ? "recovery" : "transaction", state: "queued", createdAt: Date.now() };
    await authorizeBunkerOperation(state, op); current();
    state.operations.push(op); compactBunkerJournal(state, !input.recovery); await writeBunkerState(state, current);
    // Recovery starts in settings, whose caller opens the exact review and preserves Back.
    if (!input.recovery && options.notifyRenderer !== false) chrome.runtime.sendMessage({ type: "newSafeBunkerRequest", accountId: input.accountId, requestId: id }).catch(() => {});
    return op;
  }));
}
export async function queueBunkerTransaction(accountId: string, tx: { chainId: number; from?: string; to?: string; value?: string; data?: string }, route: BunkerRoute) {
  const account = await getAccountById(accountId);
  if (!account || tx.from && tx.from.toLowerCase() !== account.address.toLowerCase()) throw new Error("Transaction sender does not match Bunker");
  const normalized = normalizeTransactionValue(tx.value);
  if (!normalized.ok || !tx.to) throw new Error(normalized.ok ? "Bunker contract creation is unsupported" : normalized.error);
  return queueBunkerOperation({ accountId, chainId: tx.chainId, id: route.requestId,
    calls: [{ to: tx.to as Hex, value: BigInt(normalized.value).toString() as `${bigint}`, data: (tx.data ?? "0x") as Hex, operation: 0 }], routes: [route] });
}
const activeReviews = new Map<string, symbol>();
const reviewSnapshot = (state: Awaited<ReturnType<typeof stateForAccount>>) => JSON.stringify({ ...state, reconcileAfter: undefined,
  operations: state.operations.map((op) => ({ ...op, published: undefined, resultPublished: undefined })) });
export async function reviewBunkerOperation(accountId: string, id: string, payerId: string, client: PublicClient, overrides?: GasOverrides, feeToken: unknown = "native") {
  const current = captureBunkerAccess(); current();
  const account = await getAccountById(accountId); if (account?.type !== "safeBunker") throw new Error("Bunker not found");
  const reviewKey = `${accountId}:${id}`, claim = Symbol(); activeReviews.set(reviewKey, claim);
  try {
    const state = await bunkerStep("state", () => stateForAccount(accountId)); current();
    const baseline = reviewSnapshot(state); const op = state.operations.find((o) => o.id === id);
    if (!op || ["confirmed", "reverted", "rejected", "invalidated"].includes(op.state)) throw new Error("Bunker operation is unavailable");
    if (op.members?.some(member => member.swapMeta || member.swapContext)) throw new Error("Separate grouped swaps before execution");
    if (state.recovery) throw new Error("Complete recovery scan first");
    if (op.kind === "recovery") captureBunkerAccess()();
    if (state.exposureUnknown && op.kind === "transaction") throw new Error("Rotate the restored owner before spending");
    const blockers = state.operations.filter((o) => outstanding(o) && o.id !== id);
    if (blockers.some(isBunkerExecutionInFlight) && op.kind === "transaction") throw new Error("Waiting for the previous transaction to confirm.");
    if (blockers.length && op.kind === "transaction") throw new Error("Resolve the current signed operation first");
    const head = state.operations.find((o) => ["queued", "reviewed", "signed", "ambiguous", "pending"].includes(o.state));
    if (!op.signature && head?.id !== id && op.kind === "transaction") throw new Error("Earlier Bunker requests must settle first");
    const routeGate = await bunkerStep("authorization", () => authorizeBunkerOperation(state, op));
    const { live, owner, next, nextIndex } = await bunkerStep("authority", () => verifyBunkerOwner(state, current(), client, op.signature ? op.review?.nextIndex : undefined, current));
    state.nextIndex = nextIndex;
    if (!op.signature) op.scanBlock = live.verifiedAtBlock;
    if (op.nativeMax && !op.signature) {
      const balance = await client.getBalance({ address: state.plan.address });
      if (balance <= 0n) throw new Error("Bunker has insufficient native balance");
      const limit = BigInt(op.nativeMax.limit);
      op.calls[0] = { ...op.calls[0], value: (balance < limit ? balance : limit).toString() as `${bigint}` };
    }
    let built = await bunkerStep("calls", async () => buildBunkerTransaction(state.plan.address, BigInt(live.nonce), owner, next, op.calls, op.kind !== "transaction", state.chainId));
    if (op.signature && op.review?.safeTxHash !== built.safeTxHash) throw new Error("Signed Safe transaction is stale. Reconcile or recover.");
    const selfPaid = payerId === accountId;
    let base: Omit<import("./types").BunkerReview, "digest">;
    if (selfPaid) {
      if (op.signature) throw new Error("Signed Safe transaction is stale. Reconcile or recover.");
      const { prepareBunkerFee } = await import("./feePayment");
      const prepareFee = () => bunkerStep("feePayment", () => prepareBunkerFee(state, built.calls.map(c => ({ to: c.to, value: BigInt(c.value), data: c.data })), feeToken, client));
      let prepared = await prepareFee();
      if (op.nativeMax && feeToken === "native") {
        const deposit = await client.readContract({ address: ENTRY_POINT_V07, abi: parseAbi(["function balanceOf(address account) view returns(uint256)"]), functionName: "balanceOf", args: [state.plan.address] });
        let reserve = 0n;
        for (let pass = 0; pass < 3; pass++) {
          const nextAmount = bunkerNativeMaxAmount(BigInt(prepared.fee.tokenBalance), BigInt(op.nativeMax.limit), deposit, BigInt(prepared.fee.maximumTokenCost), reserve);
          reserve = nextAmount.reserve;
          if (nextAmount.amount <= 0n) throw new Error("Bunker has insufficient native balance");
          if (BigInt(op.calls[0].value) <= nextAmount.amount && prepared.fee.sufficientBalance) break;
          if (pass === 2) throw new Error("Review this Bunker operation again");
          op.calls[0] = { ...op.calls[0], value: nextAmount.amount.toString() as `${bigint}` };
          built = buildBunkerTransaction(state.plan.address, BigInt(live.nonce), owner, next, op.calls, false, state.chainId);
          prepared = await prepareFee();
        }
      }
      const { fee, maxFee } = prepared;
      const value = op.calls.reduce((sum, c) => sum + BigInt(c.value), 0n);
      if (await client.getBalance({ address: state.plan.address }) < value) throw new Error("Bunker has insufficient native balance");
      base = { expiresAt: fee.validUntil * 1000, payerId, payerAddress: state.plan.address,
        ownerIndex: state.ownerIndex, nextIndex: state.nextIndex, nonce: Number(live.nonce), configEpoch: live.configEpoch,
        transaction: built.transaction, safeTxHash: built.safeTxHash, feePayment: fee, maxFee,
        gas: { gasLimit: fee.userOperation.callGasLimit === "0x0" ? "0" : BigInt(fee.userOperation.callGasLimit).toString(),
          maxFeePerGas: BigInt(fee.userOperation.maxFeePerGas).toString(), maxPriorityFeePerGas: BigInt(fee.userOperation.maxPriorityFeePerGas).toString() } };
    } else {
    const payer = await bunkerPayer(payerId);
    const data = bunkerExecutionData(built.transaction, op.signature ?? bunkerPreviewSignature(owner));
    // Preview-only owner-sender v=1. Final signed execution is simulated from the actual payer.
    const [estimate, fees, payerBalance, safeBalance] = await Promise.all([
      bunkerStep("estimate", () => client.estimateGas({ account: op.signature ? payer.address as Hex : owner, to: state.plan.address, data })),
      bunkerStep("fees", () => client.estimateFeesPerGas()),
      bunkerStep("balance", () => client.getBalance({ address: payer.address as Hex })),
      bunkerStep("balance", () => client.getBalance({ address: state.plan.address })),
    ]);
    const gas = overrides ?? { gasLimit: (estimate * 125n / 100n + 25000n).toString(), maxFeePerGas: fees.maxFeePerGas!.toString(), maxPriorityFeePerGas: fees.maxPriorityFeePerGas!.toString() };
    validateSafeGasOverrides(gas);
    if (BigInt(gas.gasLimit) < estimate || BigInt(gas.gasLimit) > 10000000n) throw new Error("Gas limit cannot cover this execution");
    const maxFee = (BigInt(gas.gasLimit) * BigInt(gas.maxFeePerGas)).toString();
    if (payerBalance < BigInt(maxFee)) throw new Error("Gas payer has insufficient native balance");
    const value = op.calls.reduce((sum, c) => sum + BigInt(c.value), 0n);
    if (safeBalance < value) throw new Error("Bunker has insufficient native balance");
    base = { expiresAt: Date.now() + 5 * 60000, payerId, payerAddress: payer.address.toLowerCase() as Hex,
      ownerIndex: state.ownerIndex, nextIndex: state.nextIndex, nonce: Number(live.nonce), configEpoch: live.configEpoch,
      transaction: built.transaction, safeTxHash: built.safeTxHash, gas, maxFee };
    }
    if (op.nativeMax && !op.signature && op.transferMeta) op.transferMeta = { ...op.transferMeta, amount: formatUnits(BigInt(op.calls[0].value), 18) };
    op.review = { ...base, digest: keccak256(stringToHex(JSON.stringify({ id, calls: op.calls, routes: op.routes, ...base }))) };
    if (!op.signature) op.state = "reviewed";
    return await withStorageLock(`bunker:${account.bunkerId}`, () => withStorageLock(WALLET_SECRET_OPERATION_LOCK_KEY, async () => {
      routeGate(); current();
      const latest = await stateForAccount(accountId);
      if (activeReviews.get(reviewKey) !== claim || reviewSnapshot(latest) !== baseline) throw new Error("Bunker review changed");
      const target = latest.operations.find((item) => item.id === id)!;
      latest.nextIndex = state.nextIndex; target.review = op.review; target.scanBlock = op.scanBlock;
      if (target.nativeMax && !target.signature) { target.calls = op.calls; target.transferMeta = op.transferMeta; }
      if (!target.signature) target.state = op.state;
      compactBunkerJournal(latest, op.kind !== "recovery");
      routeGate(); current(); await bunkerStep("save", () => writeBunkerState(latest, current)); return target;
    }));
  } finally { if (activeReviews.get(reviewKey) === claim) activeReviews.delete(reviewKey); }
}
export async function confirmBunkerOperation(accountId: string, id: string, digest: string, remember: boolean, client: PublicClient) {
  const current = captureBunkerAccess(); current();
  const account = await getAccountById(accountId); if (account?.type !== "safeBunker") throw new Error("Bunker not found");
  const snapshot = await stateForAccount(accountId);
  if (snapshot.operations.find(o => o.id === id)?.review?.feePayment) {
    const { confirmBunkerUserOperation } = await import("./feeExecution");
    return confirmBunkerUserOperation(accountId, id, digest, remember, client);
  }
  return withStorageLock(`bunker:${account.bunkerId}`, async () => {
    let state = await stateForAccount(accountId); let op = state.operations.find((o) => o.id === id);
    if (!op?.review || op.review.digest !== digest || op.review.expiresAt < Date.now() || ["confirmed", "reverted", "rejected", "invalidated"].includes(op.state)) throw new Error("Review this Bunker operation again");
    if (op.kind === "recovery") captureBunkerAccess()();
    if (state.recovery) throw new Error("Complete recovery scan first");
    if (op.outer) throw new Error("Check the submitted transaction before retrying");
    if (state.exposureUnknown && op.kind === "transaction" || state.operations.some((o) => outstanding(o) && o.id !== id) && op.kind === "transaction") throw new Error("Bunker owner exposure is unresolved");
    const review = structuredClone(op.review); const routeGate = await authorizeBunkerOperation(state, op);
    if (review.ownerIndex !== state.ownerIndex || review.nextIndex !== state.nextIndex) throw new Error("Bunker owner or nonce changed");
    bunkerExecutionProgress(accountId, id, "signing");
    const entry = await bunkerEntry(state.id);
    const prepared = await withBunkerDraftSeed(entry, current(), async (seed) => {
      const owner = deriveBunkerOwner(seed, state.chainId, state.ownerIndex), next = deriveBunkerOwner(seed, state.chainId, review.nextIndex);
      if (!op!.signature && state.usedOwners.includes(next)) throw new Error("Bunker review changed");
      const rebuilt = buildBunkerTransaction(state.plan.address, BigInt(review.nonce), owner, next, op!.calls, op!.kind !== "transaction", state.chainId);
      if (rebuilt.safeTxHash !== review.safeTxHash || JSON.stringify(rebuilt.transaction) !== JSON.stringify(review.transaction)) throw new Error("Bunker reviewed transaction changed");
      const signature = op!.signature ?? await withBunkerOwnerKey(seed, state.chainId, state.ownerIndex, (key) => privateKeyToAccount(key).sign({ hash: review.safeTxHash }));
      return { owner, next, signature };
    });
    if (!op.signature) {
      routeGate(); current();
      await withStorageLock(WALLET_SECRET_OPERATION_LOCK_KEY, async () => {
        current(); state = await stateForAccount(accountId); op = state.operations.find((o) => o.id === id)!;
        if (op.review?.digest !== digest) throw new Error("Bunker review changed");
        state.usedOwners = [...new Set([...state.usedOwners, prepared.next])];
        op.signature = prepared.signature; op.state = "signed";
        // Review verified the deployment; the final preflight selects a fresh block.
        op.scanBlock ??= state.plan.fromBlock;
        await writeBunkerState(state, current);
      });
    }
    // The persisted signature precedes every signature-bearing RPC request.
    const data = bunkerExecutionData(review.transaction, op!.signature!);
    try {
      const result = await submitBunkerOuter({ chainId: state.chainId, id, payerId: review.payerId, payerAddress: review.payerAddress,
        to: state.plan.address, data, rpc: client.transport.url as string, gas: review.gas, current,
        beforeBroadcast: async ({ serializedTransaction, transactionHash }) => {
          bunkerExecutionProgress(accountId, id, "checking");
          if (review.expiresAt < Date.now()) throw new Error("Review this Bunker operation again");
          const block = await preflightBunkerExecution(state, review, prepared.owner, prepared.next, data, client);
          const gate = await authorizeBunkerOperation(state, op!); gate(); routeGate(); current();
          if (review.expiresAt < Date.now()) throw new Error("Review this Bunker operation again");
          state = await stateForAccount(accountId); op = state.operations.find((o) => o.id === id)!;
          if (op.review?.digest !== digest || op.outer) throw new Error("Bunker execution claim changed");
          op.outer = { raw: serializedTransaction, hash: transactionHash, payerId: review.payerId, payerAddress: review.payerAddress };
          op.state = "ambiguous"; op.scanBlock = block.toString();
          if (remember) state.defaultPayer = { id: review.payerId, address: review.payerAddress };
          gate(); routeGate(); current(); await writeBunkerState(state, current); gate(); current();
          bunkerExecutionProgress(accountId, id, "broadcasting");
        } });
      await withStorageLock(WALLET_SECRET_OPERATION_LOCK_KEY, async () => {
        state = await stateForAccount(accountId); op = state.operations.find((o) => o.id === id)!;
        op.state = result.broadcastUncertain ? "ambiguous" : "pending"; await writeBunkerState(state, current);
      });
      bunkerExecutionProgress(accountId, id, "submitted");
      await publishBunkerRoutes(state, op!, "submitted");
      await withStorageLock(WALLET_SECRET_OPERATION_LOCK_KEY, () => writeBunkerState(state, current));
      return op!;
    } catch (error) {
      if (bunkerStepMessage(error) || bunkerPolicyMessage(error)) throw error;
      // Never return raw transport errors that might contain signed calldata.
      throw new Error("Execution paused. Check operation status before retrying.");
    }
  });
}
export async function rejectBunkerOperation(accountId: string, id: string, onCommitted?: () => void, invalidInbox = false) {
  const current = captureBunkerAccess(); current(); const account = await getAccountById(accountId);
  if (account?.type !== "safeBunker") throw new Error("Bunker not found");
  const result = await withStorageLock(`bunker:${account.bunkerId}`, () => withStorageLock(WALLET_SECRET_OPERATION_LOCK_KEY, async () => {
    const state = await stateForAccount(accountId); const op = state.operations.find((o) => o.id === id);
    if (invalidInbox && op) return "raced";
    if (!op && await rejectBunkerInboxEntry(state, id, current, invalidInbox)) return "inbox";
    if (!op || op.signature || !["queued", "reviewed"].includes(op.state)) throw new Error("Signed Bunker operations require a recovery rotation");
    op.state = "rejected"; await writeBunkerState(state, current);
    return "journal";
  }));
  if (result === "raced") return;
  current(); onCommitted?.();
  if (result === "journal") await publishBunkerRejection(account.bunkerId, id, current);
}
