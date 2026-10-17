import assert from "node:assert/strict";
import test from "node:test";
import { namehash } from "viem";
import { getEnsRecipientHistory } from "../../src/chrome/ensBrowsing/recipientHistory";

const emptyEvents = { addrChangeds: [], multicoinAddrChangeds: [] };

test("ENS history queries only address events for the current resolver", async () => {
  const original = globalThis.fetch;
  const bodies: any[] = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)); bodies.push(body);
    assert.equal(init?.redirect, "error");
    assert.equal(init?.credentials, "omit");
    if (body.method) return Response.json({ jsonrpc: "2.0", id: body.id, result: { timestamp: body.params[0] } });
    if (body.query.includes("RecipientDomain")) return Response.json({ data: { domain: { resolver: { id: "resolver-id" }, registration: { id: "registration-id" } } } });
    return Response.json({ data: { addrChangeds: [{ blockNumber: 200 }],
      multicoinAddrChangeds: [{ blockNumber: 250 }] } });
  };
  try {
    const history = await getEnsRecipientHistory("TeSt-HiStOrY.eth", 8453);
    assert.deepEqual(history, { addressUpdatedAt: 250000 });
    assert.equal(bodies[0].variables.node, namehash("test-history.eth"));
    assert.deepEqual(bodies[1].variables.coinTypes, ["60", "2147483648", "2147492101"]);
    assert.equal(bodies[1].variables.resolver, "resolver-id");
    assert.doesNotMatch(bodies[0].query, /registration/);
    assert.doesNotMatch(bodies[1].query, /transfers|newOwners|newResolvers|wrapped/i);
    assert.equal(bodies.length, 3);
    await getEnsRecipientHistory("test-history.eth", 8453);
    assert.equal(bodies.length, 3, "short-lived cache reuses public history");
  } finally { globalThis.fetch = original; }
});

test("ENS history distinguishes absent events from missing or malformed data", async () => {
  const original = globalThis.fetch;
  let events: unknown = emptyEvents;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    return Response.json({ data: body.query.includes("RecipientDomain")
      ? { domain: { resolver: { id: "resolver" }, registration: null } } : events });
  };
  try {
    assert.deepEqual(await getEnsRecipientHistory("empty-history.eth", 1), {
      addressUpdatedAt: null,
    });
    events = {};
    await assert.rejects(getEnsRecipientHistory("missing-history.eth", 1), /Incomplete/);
    events = { ...emptyEvents, addrChangeds: [{ blockNumber: "malformed" }] };
    await assert.rejects(getEnsRecipientHistory("malformed-history.eth", 1), /Invalid ENS event/);
    events = null;
    await assert.rejects(getEnsRecipientHistory("null-history.eth", 1), /omitted data/);
  } finally { globalThis.fetch = original; }
});

test("unsupported names and invalid chains never query the subgraph", async () => {
  for (const name of ["name.gwei", "name.base.eth", "0x123", "name.eth.evil", "bad name.eth"]) {
    await assert.rejects(getEnsRecipientHistory(name, 1));
  }
  for (const chain of [-1, 0, 1.5, "1", 0x80000000]) await assert.rejects(getEnsRecipientHistory("test.eth", chain));
});
