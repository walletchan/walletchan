import assert from "node:assert/strict";
import test from "node:test";
import { buildBunkerHistory } from "../../src/chrome/safeBunker/history";
import { compactHistoryTransaction } from "../../src/chrome/history/recordCodec";
import { getSafeRequestAction } from "../../src/components/SafeApprovals/safeProposalPresentation";
import type { BunkerOperation, BunkerState } from "../../src/chrome/safeBunker/types";

const safe = `0x${"11".repeat(20)}` as const, recipient = `0x${"22".repeat(20)}` as const;
const hash = `0x${"33".repeat(32)}` as const;
const calls = [{ to: recipient, value: "1000000000000000", data: "0x", operation: 0 }] as BunkerOperation["calls"];
const state = { accountId: "bunker-account", plan: { address: safe } } as BunkerState;
const op = { id: "request", calls, routes: [{ origin: "https://app.uniswap.org" }], kind: "transaction", state: "confirmed",
  createdAt: 123, receipt: { hash, timestamp: 456 }, signature: "secret-signature", outer: { raw: "secret-raw" } } as unknown as BunkerOperation;

test("history preserves all user actions across compaction, with no signed or rotation payloads", () => {
  const entry = buildBunkerHistory(state, { ...op, calls: [...calls, ...calls] })!;
  assert.equal(entry.functionName, undefined);
  assert.equal(entry.tx.from, safe);
  assert.equal(entry.txHash, hash);
  assert.equal(entry.status, "success");
  const persisted = compactHistoryTransaction(entry).transaction;
  assert.equal(persisted.safeBunkerMeta?.calls.length, 2);
  assert.ok(!JSON.stringify(persisted).includes("secret"));
  assert.equal(persisted.tx.data, undefined);
});

test("Bunker actions reuse normal Safe transfer and decoded function labels", () => {
  const item = { calls, transaction: { nonce: 0 } };
  assert.equal(getSafeRequestAction(item, "ETH", 18, undefined, {}).intent, "Send 0.001 ETH");
  const contract = { ...item, calls: [{ ...calls[0], data: "0x12345678" as const }] };
  assert.equal(getSafeRequestAction(contract, "ETH", 18, undefined, { 0: "execute" }).intent, "Execute");
});

test("unsigned requests never enter history; recovery is an explicit action", () => {
  assert.equal(buildBunkerHistory(state, { ...op, outer: undefined, receipt: undefined }), null);
  const recovery = buildBunkerHistory(state, { ...op, kind: "recovery", calls: [] })!;
  assert.equal(recovery.functionName, "Owner rotation");
  assert.deepEqual(recovery.safeBunkerMeta?.calls, []);
});

test("details reconstruct every user call after compaction without resolving outer calldata", async () => {
  const { getHistoryCalls } = await import("../../src/components/TransactionDetails/historyCallModel");
  const entry = compactHistoryTransaction(buildBunkerHistory(state, { ...op, calls: [...calls, ...calls] })!).transaction;
  const detailCalls = getHistoryCalls(entry)!;
  assert.equal(detailCalls.length, 2);
  assert.ok(detailCalls.every((call) => call.to === recipient && call.data === "0x" && call.value === "0x38d7ea4c68000"));
});


test("rotation metadata uses the exact review indices and survives history compaction", async () => {
  const { buildBunkerTransaction } = await import("../../src/chrome/safeBunker/transaction");
  const oldOwner = `0x${"44".repeat(20)}` as const, newOwner = `0x${"55".repeat(20)}` as const;
  for (const recovery of [false, true]) {
    const built = buildBunkerTransaction(safe, 0n, oldOwner, newOwner, recovery ? [] : calls, recovery);
    const review = { transaction: built.transaction, ownerIndex: 7, nextIndex: 12 } as BunkerOperation["review"];
    const entry = buildBunkerHistory(state, { ...op, review })!;
    assert.deepEqual(compactHistoryTransaction(entry).transaction.safeBunkerMeta?.rotation,
      { oldOwner, newOwner, oldIndex: 7, newIndex: 12 });
  }
  assert.equal(buildBunkerHistory(state, op)!.safeBunkerMeta?.rotation, undefined);
});

test("missing or unrelated rotation data is omitted instead of guessing current owners", async () => {
  const { getBunkerHistoryRotation } = await import("../../src/chrome/safeBunker/historyRotation");
  assert.equal(getBunkerHistoryRotation(safe), undefined);
  for (const transaction of [
    { to: safe, data: "0x", value: "0", operation: 0 },
    { to: recipient, data: "0x", value: "0", operation: 0 },
    { to: safe, data: "0x", value: "0", operation: 1 },
  ]) {
    assert.equal(getBunkerHistoryRotation(safe, { transaction, ownerIndex: 3, nextIndex: 8 } as BunkerOperation["review"]), undefined);
  }
});

test("deployment history keeps both ownership projections and semantic identity after compaction", async () => {
  const { getActivityPresentation } = await import("../../src/components/Activity/activityModel");
  const payerAddress = recipient;
  for (const from of [safe, payerAddress]) {
    const entry = compactHistoryTransaction({ id: `deploy:${from}`, accountId: from, origin: "Deploy Safe Bunker", favicon: null,
      status: "pending", chainId: 11155111, chainName: "Sepolia", createdAt: 1, txHash: hash,
      safeDeploymentMeta: { safeAddress: safe, payerAddress }, tx: { from, to: recipient, value: "0", chainId: 11155111 } }).transaction;
    assert.equal(entry.ownerAddress, from);
    assert.deepEqual(entry.safeDeploymentMeta, { safeAddress: safe, payerAddress });
    assert.equal(getActivityPresentation(entry).intent, "Deploy Safe Bunker");
    assert.equal(entry.safeBunkerMeta, undefined);
  }
});
