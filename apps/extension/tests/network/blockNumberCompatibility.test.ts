import assert from "node:assert/strict";
import test from "node:test";
import { createPublicClient } from "viem";
import { secureHttpTransport } from "../../src/chrome/network/rpcClient";
import { rpcFailureMessage, rpcFailureReason } from "../../src/chrome/network/rpcDiagnostics";
import { bunkerStep, bunkerStepMessage } from "../../src/chrome/safeBunker/errors";

const endpoint = "https://rpc.example/private-api-key";
const secret = "signed calldata 0xdeadbeef private-api-key";
const result = (value: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: value }));
const failure = (status = 200, code = -32601) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code, message: secret } }), { status });

async function withRpc(run: (client: ReturnType<typeof createPublicClient>, calls: any[]) => Promise<void>, respond: (method: string, params: unknown) => Response | Promise<Response>) {
  const before = globalThis.fetch, calls: any[] = [];
  globalThis.fetch = (async (input, init) => {
    assert.equal(String(input), endpoint);
    assert.equal(init?.credentials, "omit");
    assert.equal(init?.redirect, "error");
    const body = JSON.parse(init!.body as string);
    calls.push(body);
    return respond(body.method, body.params);
  }) as typeof fetch;
  try { await run(createPublicClient({ cacheTime: 0, transport: secureHttpTransport(endpoint, { retryCount: 0 }) }), calls); }
  finally { globalThis.fetch = before; }
}

test("supported blockNumber uses one request", async () => {
  await withRpc(async (client, calls) => {
    assert.equal(await client.getBlockNumber(), 42n);
    assert.deepEqual(calls.map(x => x.method), ["eth_blockNumber"]);
  }, () => result("0x2a"));
});

for (const status of [200, 400]) test(`unsupported blockNumber HTTP ${status} falls back on the same endpoint and pins later reads`, async () => {
  await withRpc(async (client, calls) => {
    const height = await client.getBlockNumber();
    assert.equal(height, 42n);
    await client.getCode({ address: "0x0000000000000000000000000000000000000001", blockNumber: height });
    assert.deepEqual(calls.map(x => x.method), ["eth_blockNumber", "eth_getBlockByNumber", "eth_getCode"]);
    assert.deepEqual(calls[1].params, ["latest", false]);
    assert.equal(calls[2].params[1], "0x2a");
  }, method => method === "eth_blockNumber" ? failure(status) : result(method === "eth_getBlockByNumber" ? { number: "0x2a" } : "0x"));
});

for (const value of [null, {}, { number: null }, { number: "pending" }, { number: "0x00" }, { number: "0x" + "f".repeat(65) }]) test(`invalid latest block fails closed: ${JSON.stringify(value)}`, async () => {
  await withRpc(async client => {
    await assert.rejects(bunkerStep("authority", () => client.getBlockNumber()), error => {
      assert.equal(rpcFailureReason(error), "blockHeight");
      assert.match(bunkerStepMessage(error)!, /eth_blockNumber or eth_getBlockByNumber/);
      assert.doesNotMatch(bunkerStepMessage(error)!, /deadbeef|private-api-key/);
      return true;
    });
  }, method => method === "eth_blockNumber" ? failure() : result(value));
});

for (const [status, reason] of [[200, "blockHeight"], [400, "blockHeight"], [401, "access"], [403, "access"], [429, "rateLimit"], [503, "unavailable"]] as const) test(`failed fallback gives safe diagnostic for HTTP ${status}`, async () => {
  await withRpc(async client => {
    await assert.rejects(bunkerStep("authority", () => client.getBlockNumber()), error => {
      assert.equal(rpcFailureReason(error), reason);
      assert.match(bunkerStepMessage(error)!, /RPC.*Network settings/);
      assert.doesNotMatch(bunkerStepMessage(error)!, /deadbeef|private-api-key/);
      return true;
    });
  }, () => failure(status, status === 200 || status === 400 ? -32601 : -32000));
});

test("other RPC methods retain their original errors and are never replayed", async () => {
  await withRpc(async (client, calls) => {
    await assert.rejects(client.request({ method: "eth_sendRawTransaction", params: ["0x1234"] }));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "eth_sendRawTransaction");
  }, () => failure());
});

test("nested timeout and network diagnostics survive wrappers without raw text", () => {
  for (const [name, reason] of [["HttpRequestTimeoutError", "timeout"], ["TypeError", "unavailable"]]) {
    const error = { name: "RpcRequestError", cause: { name: "HttpRequestError", message: secret, cause: { name, message: secret } } };
    assert.equal(rpcFailureReason(error), reason);
    assert.doesNotMatch(rpcFailureMessage(error)!, /deadbeef|private-api-key/);
  }
  const cycle: any = { name: "Error" }; cycle.cause = cycle;
  assert.equal(rpcFailureMessage(cycle), null);
  assert.equal(bunkerStepMessage(new Error(secret)), null);
});

test("offline RPC reports connectivity instead of an authority failure", async () => {
  await withRpc(async client => {
    await assert.rejects(bunkerStep("authority", () => client.getBlockNumber()), error => {
      assert.equal(rpcFailureReason(error), "unavailable");
      assert.match(bunkerStepMessage(error)!, /selected RPC is unavailable/);
      return true;
    });
  }, () => { throw new TypeError(secret); });
});

test("actual bounded transport timeout survives viem error wrapping", async () => {
  const before = globalThis.fetch;
  globalThis.fetch = (async (_input, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
  })) as typeof fetch;
  try {
    const client = createPublicClient({ transport: secureHttpTransport(endpoint, { retryCount: 0, timeout: 10 }) });
    await assert.rejects(bunkerStep("fees", () => client.getGasPrice()), error => {
      assert.equal(rpcFailureReason(error), "timeout");
      assert.match(bunkerStepMessage(error)!, /RPC timed out/);
      return true;
    });
  } finally { globalThis.fetch = before; }
});
