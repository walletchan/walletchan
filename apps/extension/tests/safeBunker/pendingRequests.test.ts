import assert from "node:assert/strict";
import test from "node:test";
import { getPendingBunkerRequests, projectBunkerPending, readBunkerPendingIndex } from "../../src/chrome/safeBunker/pendingRequests";

const request = { id: "request-one", accountId: "bunker-one", createdAt: 100 };
test("notification projection excludes submitted and terminal operations and contains no signing material", () => {
  const states = ["queued", "reviewed", "signed", "pending", "ambiguous", "confirmed", "rejected", "invalidated"];
  const state = { activated: true, archived: false, accountId: "bunker-one", operations: states.map((s, n) => ({ state: s, id: s, createdAt: n, signature: "secret", calls: ["secret"], review: { payerId: "secret" } })) } as never;
  const entries = projectBunkerPending(state);
  assert.deepEqual(entries.map(r => r.id), ["queued", "reviewed", "signed", "ambiguous"]);
  assert.equal(JSON.stringify(entries).includes("secret"), false);
  assert.deepEqual(projectBunkerPending({ ...state as any, archived: true }), []);
});

test("pending notifications deduplicate inbox handoff, survive locked reads and ignore removed accounts", async () => {
  const before = globalThis.chrome;
  const data: Record<string, unknown> = { accounts: [{ id: "bunker-one", type: "safeBunker" }], safeBunkerPendingV1: [request, { id: "removed", accountId: "removed", createdAt: 10 }], safeBunkerInboxV1: [{ id: request.id, accountId: request.accountId, chainId: 11155111, calls: [{ to: "0x1111111111111111111111111111111111111111", value: "0", data: "0x", operation: 0 }], routes: [{ kind: "wallet", origin: "WalletChan", requestId: request.id }] }] };
  globalThis.chrome = { storage: { local: { get: async (key: string) => ({ [key]: data[key] }) } } } as never;
  try {
    assert.deepEqual(await getPendingBunkerRequests(), [request]);
    delete data.safeBunkerPendingV1;
    assert.deepEqual(await getPendingBunkerRequests(), [{ ...request, createdAt: 0 }]);
    data.safeBunkerInboxV1 = [];
    assert.deepEqual(await getPendingBunkerRequests(), []);
    data.safeBunkerPendingV1 = [{ ...request, calldata: "must-not-be-accepted" }];
    await assert.rejects(readBunkerPendingIndex(), /Invalid Bunker pending index/);
  } finally { globalThis.chrome = before; }
});

test("submitted and ambiguous outer transactions leave notifications immediately", () => {
  const operations = ["pending", "ambiguous", "signed"].map((state, n) => ({ id: `sent-${n}`, state, createdAt: n, outer: { hash: `0x${"11".repeat(32)}`, raw: "sensitive signed bytes" } }));
  const next = { id: "next", state: "queued", createdAt: 4 };
  assert.deepEqual(projectBunkerPending({ activated: true, archived: false, accountId: "bunker-one", operations: [...operations, next] } as never), [{ id: "next", accountId: "bunker-one", createdAt: 4 }]);
});
