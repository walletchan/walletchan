import assert from "node:assert/strict";
import test from "node:test";
import { bunkerStep, BunkerStepError } from "../../src/chrome/safeBunker/errors";
import { bunkerFeePaymentError } from "../../src/chrome/background/transactionExecutionRouterSupport";
import { getFeePaymentProviderErrorMessage, INSUFFICIENT_REMAINING_FEE_TOKEN_ERROR } from "../../src/chrome/feePayment/errors";
import { PimlicoRpcError } from "../../src/chrome/feePayment/pimlicoClient";

const fallback = "Could not prepare the Bunker gas quote. Retry, or choose another gas token.";

test("recognized post-operation fee collection failure survives Bunker step and quote boundaries", async () => {
  const message = getFeePaymentProviderErrorMessage("eth_estimateUserOperationGas",
    "UserOperation reverted during simulation with reason: AA50 postOp reverted 0x7939f424");
  let failure: unknown;
  try { await bunkerStep("feePayment", async () => { throw new PimlicoRpcError(message, -32500); }); }
  catch (error) { failure = error; }
  assert.deepEqual(bunkerFeePaymentError(failure, fallback), {
    success: false, error: INSUFFICIENT_REMAINING_FEE_TOKEN_ERROR,
  });
  assert.match(INSUFFICIENT_REMAINING_FEE_TOKEN_ERROR, /Not enough tokens left for gas/);
  assert.match(INSUFFICIENT_REMAINING_FEE_TOKEN_ERROR, /Reduce the amount or change gas token/);
});

test("quote routing preserves precise safe auth, pending and authority failures", () => {
  for (const message of ["Authentication changed. Unlock and retry.", "Waiting for the previous transaction to confirm.", "Bunker owner or nonce changed"]) {
    assert.equal(bunkerFeePaymentError(new Error(message), fallback).error, message);
  }
  assert.match(bunkerFeePaymentError(new BunkerStepError("authority"), fallback).error, /owner and Safe configuration/);
});

test("unrecognized RPC failure stays sanitized and is not mislabeled as insufficient tokens", async () => {
  const secret = "https://private-rpc.example/key signed calldata 0xdeadbeef";
  assert.deepEqual(bunkerFeePaymentError(new PimlicoRpcError(secret), fallback), { success: false, error: fallback });
  let failure: unknown;
  try { await bunkerStep("feePayment", async () => { throw new PimlicoRpcError(`AA23 reverted ${secret}`, -32500); }); }
  catch (error) { failure = error; }
  const response = bunkerFeePaymentError(failure, fallback);
  assert.match(response.error, /Could not prepare Bunker gas payment/);
  assert.doesNotMatch(response.error, /deadbeef|private-rpc|signed calldata|Not enough tokens/);
});
