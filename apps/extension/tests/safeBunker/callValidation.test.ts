import assert from "node:assert/strict";
import test from "node:test";
import { assertBunkerCalls, BunkerCallValidationError, BUNKER_CALLDATA_HEX_LIMIT } from "../../src/chrome/safeBunker/callValidation";
import { decodeBunkerState } from "../../src/chrome/safeBunker/stateCodec";

const address = `0x${"11".repeat(20)}`;
const call = { to: address, value: "0", data: "0x", operation: 0 };
const state = { version: 2, chainId: 8453, chainName: "Base", seedGroupId: "group", id: `bunker-source:8453:${address}`, accountId: "bunker",
  plan: { address, initializer: "0x", salt: "0", fromBlock: "0" }, activated: true, archived: false,
  ownerIndex: 0, nextIndex: 1, exposureUnknown: false, usedOwners: [], defaultPayer: null, recovery: null,
  operations: [{ id: "request", kind: "transaction", state: "queued", createdAt: 1, calls: [call], routes: [{ kind: "wallet", origin: "WalletChan", requestId: "request" }] }] };

test("unsigned and persisted calls share the exact aggregate calldata boundary", () => {
  const calls = [{ ...call, data: `0x${"ab".repeat((BUNKER_CALLDATA_HEX_LIMIT - 2) / 2)}` }];
  assertBunkerCalls(calls);
  const persisted = { ...state, operations: [{ ...state.operations[0], calls }] };
  assert.doesNotThrow(() => decodeBunkerState(persisted));
  calls[0].data += "ab";
  assert.throws(() => assertBunkerCalls(calls), BunkerCallValidationError);
  assert.throws(() => decodeBunkerState(persisted), BunkerCallValidationError);
  assert.throws(() => assertBunkerCalls([{ ...call, data: `0x${"ab".repeat(62500)}` }, { ...call, data: `0x${"ab".repeat(62500)}` }]), /calldata limit/);
});

test("malformed/canonical quantity/count failures are classified before durable intake", () => {
  for (const calls of [[], Array.from({ length: 100 }, () => call), [{ ...call, to: undefined }], [{ ...call, value: "0x01" }],
    [{ ...call, value: "01" }], [{ ...call, value: (2n ** 256n).toString() }], [{ ...call, data: "0x1" }], [{ ...call, operation: 1 }], [{ ...call, extra: true }]])
    assert.throws(() => assertBunkerCalls(calls), BunkerCallValidationError);
  assert.doesNotThrow(() => assertBunkerCalls([], true));
  assert.doesNotThrow(() => assertBunkerCalls(Array.from({ length: 99 }, () => call)));
});

test("old journals remain readable and reconciliation cursors are bounded, optional metadata", () => {
  assert.equal(decodeBunkerState(state).reconcileAfter, undefined);
  assert.equal(decodeBunkerState({ ...state, reconcileAfter: "request" }).reconcileAfter, "request");
  for (const cursor of [null, 1, "", "x".repeat(257)]) assert.throws(() => decodeBunkerState({ ...state, reconcileAfter: cursor }));
});
