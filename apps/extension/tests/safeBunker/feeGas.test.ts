import assert from "node:assert/strict";
import test from "node:test";
import { bufferBunkerGasEstimate, assertBunkerGasWithinReview, BUNKER_ESTIMATED_GAS_FIELDS } from "../../src/chrome/safeBunker/feeGas";
import { bunkerStepMessage } from "../../src/chrome/safeBunker/errors";
import type { PackedUserOperationV07 } from "../../src/chrome/feePayment/pimlicoTypes";
const estimate = { callGasLimit: "0x186a0", verificationGasLimit: "0x186a0", preVerificationGas: "0x186a0", paymasterVerificationGasLimit: "0x186a0", paymasterPostOpGasLimit: "0x186a0" } as const;
const operation = { ...estimate } as PackedUserOperationV07;
test("all wallet-estimated gas budgets get headroom; paymaster postOp remains unchanged", () => {
  const gas = bufferBunkerGasEstimate(estimate, true);
  for (const key of BUNKER_ESTIMATED_GAS_FIELDS) assert.equal(BigInt(gas[key]!), 135000n);
  assert.equal(gas.paymasterPostOpGasLimit, estimate.paymasterPostOpGasLimit);
});
test("native preparation strips paymaster zero fields returned by bundlers", () => {
  const gas = bufferBunkerGasEstimate({ ...estimate, paymasterVerificationGasLimit: "0x0", paymasterPostOpGasLimit: "0x0" }, false);
  assert.equal(gas.paymasterVerificationGasLimit, undefined);
  assert.equal(gas.paymasterPostOpGasLimit, undefined);
});
test("paymaster-authorized postOp is not replaced by a fresh bundler recommendation", () => {
  assert.doesNotThrow(() => assertBunkerGasWithinReview(operation, { ...estimate, paymasterPostOpGasLimit: "0x30d40" }));
});
for (const key of BUNKER_ESTIMATED_GAS_FIELDS) test(`a real ${key} overrun remains blocked with safe numeric diagnostics`, () => {
  let failure: unknown;
  try { assertBunkerGasWithinReview(operation, { ...estimate, [key]: "0x186a1" }); } catch (error) { failure = error; }
  assert.match(bunkerStepMessage(failure)!, new RegExp(`${key} needs 100001 gas; reviewed limit is 100000`));
});
test("gas safety ceiling includes paymaster budgets", () => {
  assert.throws(() => bufferBunkerGasEstimate({ ...estimate, paymasterPostOpGasLimit: "0x989680" }, true), /Gas limit/);
  assert.throws(() => assertBunkerGasWithinReview({ ...operation, paymasterPostOpGasLimit: "0x989680" }, estimate), /Gas limit/);
});

test("Safe estimation signature matches final length without repetitive ECDSA bytes", async () => {
  const { SAFE_STUB_SIGNATURE } = await import("../../src/chrome/safeBunker/userOperation");
  const bytes = Buffer.from(SAFE_STUB_SIGNATURE.slice(2), "hex");
  assert.equal(bytes.length, 77);
  assert.ok(new Set(bytes.subarray(12)).size > 40, "compressed L2 calldata must not assume repetitive signature bytes");
});
