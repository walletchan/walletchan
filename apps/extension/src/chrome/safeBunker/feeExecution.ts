import { BunkerSubmissionError, submitBunkerUserOperation } from "./feeSubmission";
import { assertBunkerGasWithinReview } from "./feeGas";
import { privateKeyToAccount } from "viem/accounts";
import type { PublicClient } from "viem";
import { WALLET_SECRET_OPERATION_LOCK_KEY, withStorageLock } from "../storageLock";
import { getPackedUserOperationHash } from "../feePayment/submission";
import { captureBunkerAccess } from "./access";
import { bunkerEntry, verifyBunkerOwner } from "./live";
import { withBunkerDraftSeed } from "./crypto";
import { withBunkerOwnerKey } from "./derivation";
import { stateForAccount, outstanding } from "./operations";
import { writeBunkerState } from "./stateRepository";
import { buildBunkerTransaction } from "./transaction";
import { bunkerSafeOpHash, encodeBunkerUserOperationCalls, safeOperationSignature } from "./userOperation";
import { assertBunkerFeeState, bunkerFeeCalls, bunkerPimlico } from "./feePayment";
import { authorizeBunkerOperation } from "./authorization";
import { bunkerExecutionProgress } from "./progress";
import { publishBunkerRoutes } from "./publication";
import { bunkerStep, bunkerStepMessage, bunkerPolicyMessage } from "./errors";

/** The only self-funded signing/submission boundary; all signatures stay in the encrypted journal. */
export async function confirmBunkerUserOperation(accountId: string, id: string, digest: string, remember: boolean, client: PublicClient) {
  const current = captureBunkerAccess(); current();
  const initial = await stateForAccount(accountId);
  return withStorageLock(`bunker:${initial.id}`, async () => {
    let state = await stateForAccount(accountId), op = state.operations.find(o => o.id === id);
    const review = op?.review, fee = review?.feePayment;
    if (!op || !review || !fee || review.digest !== digest || review.expiresAt <= Date.now() || op.userOperationHash || !["reviewed", "signed"].includes(op.state)) throw new Error("Review this Bunker operation again");
    if (state.recovery || state.exposureUnknown && op.kind !== "recovery" || state.operations.some(o => o.id !== id && outstanding(o)) && op.kind !== "recovery") throw new Error("Bunker owner exposure is unresolved");
    const routeGate = await authorizeBunkerOperation(state, op);
    const { live, owner, next } = await verifyBunkerOwner(state, current(), client, op.signature ? review.nextIndex : undefined, current);
    if (live.configEpoch !== review.configEpoch || state.ownerIndex !== review.ownerIndex || state.nextIndex !== review.nextIndex || live.nonce !== String(review.nonce)) throw new Error("Bunker authority changed");
    const built = buildBunkerTransaction(state.plan.address, BigInt(review.nonce), owner, next, op.calls, op.kind === "recovery", state.chainId);
    if (built.safeTxHash !== review.safeTxHash || JSON.stringify(built.transaction) !== JSON.stringify(review.transaction) ||
      encodeBunkerUserOperationCalls(bunkerFeeCalls(built.calls.map(c => ({ to: c.to, value: BigInt(c.value), data: c.data })), fee)) !== fee.userOperation.callData) throw new Error("Bunker reviewed transaction changed");
    await assertBunkerFeeState(review, client); routeGate(); current();
    bunkerExecutionProgress(accountId, id, "signing");
    const signature = op.signature ?? await withBunkerDraftSeed(await bunkerEntry(state.id), current(), seed =>
      withBunkerOwnerKey(seed, state.chainId, state.ownerIndex, key => privateKeyToAccount(key).sign({ hash: bunkerSafeOpHash(fee.userOperation, state.chainId, fee.validUntil) })));
    await withStorageLock(WALLET_SECRET_OPERATION_LOCK_KEY, async () => {
      current(); const latest = await stateForAccount(accountId), target = latest.operations.find(o => o.id === id)!;
      if (target.review?.digest !== digest || target.userOperationHash || !["reviewed", "signed"].includes(target.state)) throw new Error("Bunker review changed");
      target.signature = signature; target.state = "signed"; target.scanBlock = live.verifiedAtBlock;
      latest.usedOwners = [...new Set([...latest.usedOwners, next])];
      routeGate(); await writeBunkerState(latest, current); state = latest; op = target;
    });
    const signed = { ...fee.userOperation, signature: safeOperationSignature(signature, fee.validUntil) };
    const provider = bunkerPimlico(state.chainId);
    bunkerExecutionProgress(accountId, id, "checking");
    // Exact signed estimation enforces native prefund and ERC-20 post-operation collection.
    // Never apply a new estimate to an already reviewed/signed operation.
    try {
    const estimate = await bunkerStep("feePayment", () => provider.estimateUserOperationGas(signed));
    assertBunkerGasWithinReview(signed, estimate);
    const final = await verifyBunkerOwner(state, current(), client, review.nextIndex, current);
    if (final.live.configEpoch !== review.configEpoch || final.live.nonce !== String(review.nonce)) throw new Error("Bunker authority changed");
    await assertBunkerFeeState(review, client);
    const finalGate = await authorizeBunkerOperation(state, op!); finalGate(); routeGate(); current();
    const hash = getPackedUserOperationHash(signed, state.chainId);
    await withStorageLock(WALLET_SECRET_OPERATION_LOCK_KEY, async () => {
      state = await stateForAccount(accountId); op = state.operations.find(o => o.id === id)!;
      if (op.review?.digest !== digest || op.userOperationHash || review.expiresAt <= Date.now()) throw new Error("Bunker review changed");
      op.userOperationHash = hash; op.state = "ambiguous";
      if (remember) state.defaultPayer = { id: accountId, address: state.plan.address };
      finalGate(); routeGate(); current(); await writeBunkerState(state, current); finalGate(); current();
    });
    bunkerExecutionProgress(accountId, id, "broadcasting");
    // Any failure after release remains ambiguous. Reconcile by deterministic hash;
    // never create a replacement operation while this owner signature may execute.
    const submission = await submitBunkerUserOperation(provider, signed, hash);
    await withStorageLock(WALLET_SECRET_OPERATION_LOCK_KEY, async () => {
      state = await stateForAccount(accountId); op = state.operations.find(o => o.id === id)!;
      if (op.userOperationHash !== hash) throw new Error("Bunker execution claim changed");
      op.state = submission.accepted ? "pending" : "ambiguous";
      if (submission.accepted) delete op.error; else op.error = submission.error;
      await writeBunkerState(state, current);
    });
    await publishBunkerRoutes(state, op!, "submitted");
    await withStorageLock(WALLET_SECRET_OPERATION_LOCK_KEY, () => writeBunkerState(state, current));
    if (!submission.accepted) throw new BunkerSubmissionError(submission.error);
    bunkerExecutionProgress(accountId, id, "submitted");
    return op!;
    } catch (error) {
      // Preserve exposed signatures and a useful redacted failure across reopen/restart.
      const message = bunkerStepMessage(error) ?? bunkerPolicyMessage(error) ?? "Execution paused. Check operation status before retrying.";
      await withStorageLock(WALLET_SECRET_OPERATION_LOCK_KEY, async () => {
        current(); const latest = await stateForAccount(accountId), target = latest.operations.find(o => o.id === id);
        if (target?.signature && !target.userOperationHash && target.review?.digest === digest && target.state === "signed") {
          target.error = message; await writeBunkerState(latest, current);
        }
      });
      if (bunkerStepMessage(error) || bunkerPolicyMessage(error)) throw error;
      throw new Error(message);
    }
  });
}
