import assert from "node:assert/strict";
import test from "node:test";
import { BUNKER_JOURNAL_MAX_BYTES, compactBunkerJournal } from "../../src/chrome/safeBunker/journalCapacity";
import type { BunkerOperation, BunkerState } from "../../src/chrome/safeBunker/types";

const hash = `0x${"11".repeat(32)}` as const;
function operation(id: string, bytes = 0): BunkerOperation {
  return { id, kind: "transaction", state: "confirmed", createdAt: 1, published: true, resultPublished: true,
    calls: [{ to: `0x${"22".repeat(20)}`, value: "0", data: `0x${"ab".repeat(bytes)}`, operation: 0 }],
    routes: [{ kind: "wallet", origin: "WalletChan", requestId: id }], receipt: { hash, block: "1", blockHash: hash, timestamp: 1 } };
}
function journal(operations: BunkerOperation[]): BunkerState {
  return { version: 2, id: "journal", accountId: "account", chainId: 1, chainName: "Ethereum", seedGroupId: "seed",
    plan: { address: `0x${"33".repeat(20)}`, initializer: "0x", salt: "0", fromBlock: "0" }, activated: true,
    archived: false, ownerIndex: 2, nextIndex: 3, usedOwners: [], exposureUnknown: false, defaultPayer: null, recovery: null, operations };
}
const encodedSize = (state: BunkerState) => new TextEncoder().encode(JSON.stringify(state)).length;

test("byte pressure compacts published history below the count threshold, retaining latest receipt and current warning", () => {
  const state = journal(Array.from({ length: 18 }, (_, n) => operation(`settled-${n}`, 15000)));
  const warning = state.operations[3]; warning.state = "reverted";
  warning.review = { ownerIndex: 2 } as BunkerOperation["review"];
  assert.ok(encodedSize(state) > BUNKER_JOURNAL_MAX_BYTES);
  compactBunkerJournal(state, true);
  assert.ok(encodedSize(state) < BUNKER_JOURNAL_MAX_BYTES - 32 * 1024);
  assert.ok(state.operations.length < 18);
  assert.ok(state.operations.includes(warning));
  assert.equal(state.operations.at(-1)?.id, "settled-17");
});

test("compaction preserves signatures under the current owner and every unpublished result", () => {
  const state = journal(Array.from({ length: 90 }, (_, n) => operation(`settled-${n}`, 3000)));
  const protectedOps = ["queued", "reviewed", "signed", "pending", "ambiguous", "rejected", "invalidated", "confirmed", "reverted"].map((status, i) => {
    const op = operation(`protected-${i}`); op.state = status as BunkerOperation["state"];
    op.published = false; op.resultPublished = false;
    if (["signed", "pending", "ambiguous", "invalidated"].includes(status)) op.signature = `0x${"11".repeat(65)}`;
    return op;
  });
  const expired = operation("current-expired"); expired.state = "invalidated"; expired.signature = `0x${"11".repeat(65)}`;
  expired.review = { ownerIndex: state.ownerIndex } as BunkerOperation["review"];
  state.operations.push(...protectedOps, expired);
  compactBunkerJournal(state);
  for (const op of [...protectedOps, expired]) assert.ok(state.operations.includes(op), op.id);
});

test("review reserves future raw envelope and recovery space before an owner signature is released", () => {
  const op = operation("review", 80000); op.state = "reviewed"; delete op.receipt;
  op.review = { transaction: { data: `0x${"ab".repeat(80000)}` } } as BunkerOperation["review"];
  const state = journal([op]);
  // Existing calls/review fit, but the future outer envelope would not.
  op.calls.push({ ...op.calls[0], data: `0x${"ab".repeat(30000)}` });
  assert.ok(encodedSize(state) < BUNKER_JOURNAL_MAX_BYTES);
  assert.throws(() => compactBunkerJournal(state, true), /journal limit reached/);
  assert.equal(op.signature, undefined);
});

test("a full unresolved journal fails closed instead of dropping signed evidence", () => {
  const state = journal(Array.from({ length: 20 }, (_, n) => {
    const op = operation(`signed-${n}`, 15000); op.state = "ambiguous"; op.signature = `0x${"11".repeat(65)}`; return op;
  }));
  const before = structuredClone(state);
  assert.throws(() => compactBunkerJournal(state), /journal limit reached/);
  assert.deepEqual(state, before);
});

test("ordinary count cleanup retains ten recent receipts and is idempotent", () => {
  const state = journal(Array.from({ length: 90 }, (_, n) => operation(`settled-${n}`)));
  compactBunkerJournal(state);
  assert.deepEqual(state.operations.map(op => op.id), Array.from({ length: 10 }, (_, n) => `settled-${n + 80}`));
  const before = structuredClone(state); compactBunkerJournal(state); assert.deepEqual(state, before);
});

test("signed status and recovery may consume reserved capacity, while fresh ordinary intake must retain it", () => {
  const state = journal([operation("live-a", 115000), operation("live-b", 115000)]);
  for (const op of state.operations) { op.state = "queued"; delete op.receipt; }
  const spare = BUNKER_JOURNAL_MAX_BYTES - 32 * 1024 - encodedSize(state) - 200;
  state.operations[1].calls[0].data += "ab".repeat(Math.floor(spare / 2));
  compactBunkerJournal(state, true);
  const op = state.operations[0];
  op.state = "signed"; op.signature = `0x${"11".repeat(65)}`; op.error = "x".repeat(512);
  assert.ok(encodedSize(state) > BUNKER_JOURNAL_MAX_BYTES - 32 * 1024);
  assert.throws(() => compactBunkerJournal(state, true), /journal limit reached/);
  compactBunkerJournal(state);
  assert.equal(state.operations.length, 2);
  assert.equal(op.signature.length, 132);
});

test("ordinary requests cannot consume the last recovery slot when all earlier evidence must be retained", () => {
  const state = journal(Array.from({ length: 99 }, (_, n) => {
    const op = operation(`unpublished-${n}`); op.state = "rejected"; op.resultPublished = false; return op;
  }));
  compactBunkerJournal(state, true);
  const recovery = operation("recovery"); recovery.kind = "recovery"; recovery.state = "queued"; recovery.calls = [];
  state.operations.push(recovery);
  assert.throws(() => compactBunkerJournal(state, true), /activity limit reached/);
  compactBunkerJournal(state);
  assert.equal(state.operations.length, 100);
});
