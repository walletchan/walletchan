import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import { POST } from "../app/api/gas/pimlico/[chainId]/route";

const GAS_PRICE_REQUEST = {
  jsonrpc: "2.0",
  id: 1,
  method: "pimlico_getUserOperationGasPrice",
  params: [],
};

function request(body: unknown): NextRequest {
  return new NextRequest("https://walletchan.com/api/gas/pimlico/8453", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `route-test-${Math.random()}`,
    },
    body: JSON.stringify(body),
  });
}

async function post(body: unknown) {
  return POST(request(body), { params: Promise.resolve({ chainId: "8453" }) });
}

test("fails closed when the Pimlico proxy is disabled or unconfigured", async () => {
  const priorDisabled = process.env.PIMLICO_PROXY_DISABLED;
  const priorKey = process.env.PIMLICO_API_KEY;
  try {
    process.env.PIMLICO_PROXY_DISABLED = "true";
    process.env.PIMLICO_API_KEY = "server-secret";
    assert.equal((await post(GAS_PRICE_REQUEST)).status, 503);

    delete process.env.PIMLICO_PROXY_DISABLED;
    delete process.env.PIMLICO_API_KEY;
    assert.equal((await post(GAS_PRICE_REQUEST)).status, 503);
  } finally {
    if (priorDisabled === undefined) delete process.env.PIMLICO_PROXY_DISABLED;
    else process.env.PIMLICO_PROXY_DISABLED = priorDisabled;
    if (priorKey === undefined) delete process.env.PIMLICO_API_KEY;
    else process.env.PIMLICO_API_KEY = priorKey;
  }
});

test("rejects a method outside the explicit proxy allowlist", async () => {
  const priorKey = process.env.PIMLICO_API_KEY;
  try {
    process.env.PIMLICO_API_KEY = "server-secret";
    const response = await post({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [],
    });
    assert.equal(response.status, 400);
  } finally {
    if (priorKey === undefined) delete process.env.PIMLICO_API_KEY;
    else process.env.PIMLICO_API_KEY = priorKey;
  }
});

test("forwards only to Pimlico's fixed chain endpoint with the server key", async () => {
  const priorKey = process.env.PIMLICO_API_KEY;
  const priorFetch = globalThis.fetch;
  let observedUrl = "";
  let observedBody = "";
  try {
    process.env.PIMLICO_API_KEY = "server secret";
    globalThis.fetch = async (input, init) => {
      observedUrl = String(input);
      observedBody = String(init?.body);
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const response = await post(GAS_PRICE_REQUEST);
    assert.equal(response.status, 200);
    assert.equal(
      observedUrl,
      "https://api.pimlico.io/v2/8453/rpc?apikey=server%20secret",
    );
    assert.deepEqual(JSON.parse(observedBody), GAS_PRICE_REQUEST);
    assert.equal((await response.text()).includes("server secret"), false);
  } finally {
    globalThis.fetch = priorFetch;
    if (priorKey === undefined) delete process.env.PIMLICO_API_KEY;
    else process.env.PIMLICO_API_KEY = priorKey;
  }
});

test("existing EOA sends forward unchanged without Safe authority RPC reads", async () => {
  const { privateKeyToAccount } = await import("viem/accounts");
  const { ENTRY_POINT_V07, getUserOperationTypedData } = await import("../app/api/gas/pimlico/[chainId]/policy");
  const account = privateKeyToAccount(`0x${"01".repeat(32)}`);
  const operation = {
    sender: account.address, nonce: "0x0" as const, callData: "0x1234" as const,
    callGasLimit: "0x100" as const, verificationGasLimit: "0x200" as const,
    preVerificationGas: "0x300" as const, maxFeePerGas: "0x400" as const,
    maxPriorityFeePerGas: "0x500" as const, signature: "0x" as `0x${string}`,
  };
  operation.signature = await account.signTypedData(getUserOperationTypedData(operation, 8453));
  const envelope = { jsonrpc: "2.0", id: 5, method: "eth_sendUserOperation", params: [operation, ENTRY_POINT_V07] };
  const priorKey = process.env.PIMLICO_API_KEY;
  const priorFetch = globalThis.fetch;
  let calls = 0;
  try {
    process.env.PIMLICO_API_KEY = "server-secret";
    globalThis.fetch = async (input, init) => {
      calls++;
      assert.equal(String(input), "https://api.pimlico.io/v2/8453/rpc?apikey=server-secret");
      assert.deepEqual(JSON.parse(String(init?.body)), envelope);
      return Response.json({ jsonrpc: "2.0", id: 5, result: `0x${"12".repeat(32)}` });
    };
    assert.equal((await post(envelope)).status, 200);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = priorFetch;
    if (priorKey === undefined) delete process.env.PIMLICO_API_KEY;
    else process.env.PIMLICO_API_KEY = priorKey;
  }
});

test("invalid Safe signatures consume the send budget before authority RPC checks", async () => {
  const priorKey = process.env.PIMLICO_API_KEY;
  const priorFetch = globalThis.fetch;
  const client = `invalid-safe-${Math.random()}`;
  const envelope = {
    jsonrpc: "2.0", id: 6, method: "eth_sendUserOperation",
    params: [{
      sender: "0x1111111111111111111111111111111111111111",
      nonce: "0x0", callData: "0x1234", callGasLimit: "0x100",
      verificationGasLimit: "0x200", preVerificationGas: "0x300",
      maxFeePerGas: "0x400", maxPriorityFeePerGas: "0x500",
      signature: `0x${"00".repeat(77)}`,
    }, "0x0000000071727De22E5E9d8BAf0edAc6f37da032"],
  };
  try {
    process.env.PIMLICO_API_KEY = "server-secret";
    globalThis.fetch = async () => { assert.fail("invalid/expired signature must not reach any RPC"); };
    for (let i = 0; i < 11; i++) {
      const response = await POST(new NextRequest("https://walletchan.com/api/gas/pimlico/8453", {
        method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": client },
        body: JSON.stringify(envelope),
      }), { params: Promise.resolve({ chainId: "8453" }) });
      assert.equal(response.status, i < 10 ? 401 : 429);
    }
  } finally {
    globalThis.fetch = priorFetch;
    if (priorKey === undefined) delete process.env.PIMLICO_API_KEY;
    else process.env.PIMLICO_API_KEY = priorKey;
  }
});
