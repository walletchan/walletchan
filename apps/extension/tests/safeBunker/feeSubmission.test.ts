import assert from "node:assert/strict";
import test from "node:test";
import { PimlicoRpcError } from "../../src/chrome/feePayment/pimlicoClient";
import { bunkerSubmissionMessage, submitBunkerUserOperation } from "../../src/chrome/safeBunker/feeSubmission";
import type { PackedUserOperationV07 } from "../../src/chrome/feePayment/pimlicoTypes";
const hash = `0x${"ab".repeat(32)}` as const;
const op = { signature: "0xdeadbeef" } as PackedUserOperationV07;
test("submission accepts only its deterministic hash and sends exactly once", async () => {
  let sends = 0;
  assert.deepEqual(await submitBunkerUserOperation({ sendUserOperation: async actual => { sends++; assert.equal(actual, op); return hash; } }, op, hash), { accepted: true });
  assert.equal(sends, 1);
});
for (const [name, failure, diagnostic] of [
  ["RPC rejection", new PimlicoRpcError("AA25 invalid nonce secret 0xdeadbeef", -32500, undefined, true), /RPC -32500, AA25/],
  ["proxy rejection", new PimlicoRpcError("secret signed payload", undefined, 403, true), /HTTP 403/],
  ["transport ambiguity", new Error("https://secret-key secret 0xdeadbeef"), /did not acknowledge/],
] as const) test(`${name} preserves bounded diagnostics without leaking provider payloads or retrying`, async () => {
  let sends = 0;
  const result = await submitBunkerUserOperation({ sendUserOperation: async () => { sends++; throw failure; } }, op, hash);
  assert.equal(result.accepted, false); assert.match(result.error!, diagnostic); assert.doesNotMatch(result.error!, /secret|deadbeef|https/); assert.equal(sends, 1);
});
test("a mismatched hash is ambiguous rather than acknowledged", async () => {
  const result = await submitBunkerUserOperation({ sendUserOperation: async () => `0x${"cd".repeat(32)}` }, op, hash);
  assert.equal(result.accepted, false); assert.match(result.error!, /unexpected operation hash/);
});
test("arbitrary numeric metadata and provider text cannot enter diagnostics", () => {
  assert.doesNotMatch(bunkerSubmissionMessage(new PimlicoRpcError("secret", 123456789, 9999)), /123456789|9999|secret/);
});
