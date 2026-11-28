import assert from "node:assert/strict";
import test from "node:test";
import { decodeBunkerRevertWarnings, hasBunkerRevertWarning } from "../../src/chrome/safeBunker/revertWarning";
import type { BunkerState } from "../../src/chrome/safeBunker/types";

test("only a reverted operation under the current owner requires the advisory warning", () => {
  const state = { activated: true, archived: false, ownerIndex: 3,
    operations: [{ state: "reverted", review: { ownerIndex: 3, nextIndex: 4 } }] } as BunkerState;
  assert.ok(hasBunkerRevertWarning(state));
  for (const status of ["queued", "reviewed", "signed", "ambiguous", "pending", "confirmed", "rejected", "invalidated"]) {
    assert.equal(hasBunkerRevertWarning({ ...state, operations: [{ ...state.operations[0], state: status }] } as BunkerState), false);
  }
  assert.equal(hasBunkerRevertWarning({ ...state, ownerIndex: 4 }), false, "confirmed owner advance resolves the warning");
  assert.equal(hasBunkerRevertWarning({ ...state, archived: true }), false);
  assert.equal(hasBunkerRevertWarning({ ...state, activated: false }), false);
  assert.equal(hasBunkerRevertWarning({ ...state, operations: [{ ...state.operations[0], review: undefined }] }), false);
});

test("warning metadata supports independent accounts and rejects signing material or malformed values", () => {
  assert.deepEqual(decodeBunkerRevertWarnings(undefined), []);
  assert.deepEqual(decodeBunkerRevertWarnings(["bunker-a", "bunker-b"]), ["bunker-a", "bunker-b"]);
  for (const value of [null, {}, [""], [42], ["a", "a"], [{ accountId: "a", signature: "secret" }], Array.from({ length: 101 }, (_, n) => `bunker-${n}`)]) {
    assert.throws(() => decodeBunkerRevertWarnings(value), /Invalid Bunker revert warnings/);
  }
});
