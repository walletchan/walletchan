import assert from "node:assert/strict";
import test from "node:test";
import { bunkerReconciliationPage } from "../../src/chrome/safeBunker/reconciliationPage";
import type { BunkerOperation } from "../../src/chrome/safeBunker/types";
const operation = (id: string, submitted = false) => ({ id, state: "signed", signature: "0x11", ...(submitted ? { outer: { hash: "0x22" } } : {}) }) as BunkerOperation;

test("a submitted recovery is visited ahead of five earlier unsubmitted signatures", () => {
  const ops = [...Array.from({ length: 5 }, (_, i) => operation(`old-${i}`)), operation("recovery", true)];
  const page = bunkerReconciliationPage(ops, 0);
  assert.equal(page.length, 5); assert.equal(page[0].id, "recovery");
});

test("bounded batches advance through all submitted and unsigned evidence across persisted restarts", () => {
  const ops = Array.from({ length: 17 }, (_, i) => operation(String(i), i < 8));
  const seen = new Set<string>(); let persisted: { after?: string } = {};
  for (let n = 0; n < 4; n++) {
    const { after } = JSON.parse(JSON.stringify(persisted));
    const page = bunkerReconciliationPage(ops, 0, after);
    assert.equal(page.length, 5);
    persisted = { after: page.at(-1)!.id }; // Saved even if subsequent RPC work fails.
    page.forEach(op => seen.add(op.id));
  }
  assert.equal(seen.size, 17);
});

test("a failure at the first RPC advances one attempt rather than skipping the rest of every batch", () => {
  const ops = Array.from({ length: 13 }, (_, i) => operation(String(i), i < 7));
  const seen = new Set<string>(); let after: string | undefined;
  for (let n = 0; n < ops.length; n++) {
    const [attempt] = bunkerReconciliationPage(ops, 0, after);
    after = attempt.id; seen.add(attempt.id);
  }
  assert.equal(seen.size, ops.length);
});

test("settled/removed cursor and changing queues restart safely without selecting unsigned or unrelated reverts", () => {
  const old = operation("old"); const submitted = operation("submitted", true);
  const reverted = { id: "reverted", state: "reverted", review: { ownerIndex: 3 } } as BunkerOperation;
  const others = ["queued", "reviewed", "confirmed", "rejected", "invalidated"].map(state => ({ id: state, state }) as BunkerOperation);
  assert.deepEqual(bunkerReconciliationPage([old, submitted, reverted, ...others], 3, "removed").map(op => op.id), ["submitted", "old", "reverted"]);
  assert.deepEqual(bunkerReconciliationPage([old, reverted], 4).map(op => op.id), ["old"]);
  assert.deepEqual(bunkerReconciliationPage([], 3), []);
});
