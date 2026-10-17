import assert from "node:assert/strict";
import test from "node:test";
import { earlierBunkerRequest, isPendingBunkerRequest, isUnsignedBunkerRequest, selectBunkerRequest } from "../../src/components/SafeBunker/requestQueue";
import type { BunkerOperationSummary } from "../../src/chrome/safeBunker/types";
const operation = (id: string, state: BunkerOperationSummary["state"] = "queued", kind: BunkerOperationSummary["kind"] = "transaction"): BunkerOperationSummary => ({ id, state, kind, calls: [], origins: ["WalletChan"], createdAt: 1 });

test("a newer notification resumes the first unresolved Bunker request", () => {
  const queue = [operation("older"), operation("newer")];
  assert.equal(selectBunkerRequest(queue, "newer", true)?.id, "older");
  assert.equal(selectBunkerRequest(queue, "__pending__", true)?.id, "older");
  assert.equal(selectBunkerRequest(queue, null, true), undefined);
});
test("manual queue navigation keeps later requests visible with their earlier blocker", () => {
  const queue = [operation("older"), operation("newer")];
  assert.equal(selectBunkerRequest(queue, "newer", false)?.id, "newer");
  assert.equal(earlierBunkerRequest(queue, queue[1])?.id, "older");
  assert.equal(earlierBunkerRequest(queue, queue[0]), undefined);
});
test("rejecting an earlier request advances to the remaining unsigned request", () => {
  const queue = [operation("older", "rejected"), operation("newer")].filter(isPendingBunkerRequest);
  assert.equal(selectBunkerRequest(queue, "__pending__", true)?.id, "newer");
  assert.equal(earlierBunkerRequest(queue, queue[0]), undefined);
});
test("explicit recovery can still compete with an earlier signed request", () => {
  const queue = [operation("signed", "signed"), operation("recovery", "queued", "recovery")];
  assert.equal(selectBunkerRequest(queue, "recovery", true)?.id, "recovery");
  assert.equal(earlierBunkerRequest(queue, queue[1]), undefined);
  assert.equal(queue.every(isUnsignedBunkerRequest), false);
});
test("terminal requests leave the queue and signed requests are never bulk rejectable", () => {
  for (const state of ["confirmed", "rejected", "invalidated"] as const) assert.equal(isPendingBunkerRequest(operation(state, state)), false);
  for (const state of ["signed", "pending", "ambiguous"] as const) assert.equal(isUnsignedBunkerRequest(operation(state, state)), false);
});

test("submitted transactions cannot displace the remaining approval before mining", () => {
  for (const state of ["pending", "ambiguous", "signed"] as const) {
    const sent = { ...operation("sent", state), txHash: `0x${"11".repeat(32)}` as const };
    const next = operation("next");
    const queue = [sent, next];
    assert.equal(isPendingBunkerRequest(sent), false);
    assert.equal(selectBunkerRequest(queue, "next", true)?.id, "next");
    assert.equal(selectBunkerRequest(queue, "sent", true)?.id, "next", "stale notification cannot reopen submitted execution");
    assert.equal(selectBunkerRequest(queue, "sent", false), undefined);
    assert.equal(earlierBunkerRequest(queue, next), undefined);
  }
});
