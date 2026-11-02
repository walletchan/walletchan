/** Relay transport: request shape, response parsing and endpoint validation. */
import assert from "node:assert/strict";
import test from "node:test";

import {
  LatticeTransportError,
  createLatticeRelayTransport,
  isValidLatticeDeviceId,
  normalizeLatticeRelayUrl,
} from "./protocolImports";

function fakeFetch(reply: unknown, status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(typeof reply === "string" ? reply : JSON.stringify(reply), { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

test("posts the Node Buffer JSON shape to {baseUrl}/{deviceId} and decodes the hex reply", async () => {
  const { impl, calls } = fakeFetch({ status: 200, message: "01000aff" });
  const transport = createLatticeRelayTransport({ deviceId: "AbC123", baseUrl: "https://signing.gridpl.us/", fetchImpl: impl });
  const out = await transport.send(Uint8Array.from([1, 2, 255]));
  assert.deepEqual(Array.from(out), [1, 0, 10, 255]);
  assert.equal(calls[0].url, "https://signing.gridpl.us/AbC123");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.credentials, "omit");
  assert.deepEqual(JSON.parse(calls[0].init.body as string), { data: { type: "Buffer", data: [1, 2, 255] } });
});

test("a relay error status becomes a transport error", async () => {
  const { impl } = fakeFetch({ status: 500, message: "Lattice offline" });
  const transport = createLatticeRelayTransport({ deviceId: "AbC123", baseUrl: "https://signing.gridpl.us", fetchImpl: impl });
  await assert.rejects(transport.send(new Uint8Array(1)), (err: unknown) => err instanceof LatticeTransportError && /500/.test((err as Error).message));
});

test("non-JSON and non-hex replies are rejected", async () => {
  for (const reply of ["<html>", { status: 200, message: "zz" }, { status: 200, message: "abc" }, { status: 200 }]) {
    const { impl } = fakeFetch(reply);
    const transport = createLatticeRelayTransport({ deviceId: "AbC123", baseUrl: "https://signing.gridpl.us", fetchImpl: impl });
    await assert.rejects(transport.send(new Uint8Array(1)), LatticeTransportError);
  }
});

test("device IDs are alphanumeric only", () => {
  assert.equal(isValidLatticeDeviceId("AbC123"), true);
  for (const bad of ["", "../x", "ab cd", "a/b", "abc?x"]) assert.equal(isValidLatticeDeviceId(bad), false, bad);
  assert.throws(() => createLatticeRelayTransport({ deviceId: "../x", baseUrl: "https://signing.gridpl.us" }), LatticeTransportError);
});

test("connection endpoints: https and local http allowed, others refused", () => {
  assert.equal(normalizeLatticeRelayUrl("https://signing.gridpl.us/"), "https://signing.gridpl.us");
  assert.equal(normalizeLatticeRelayUrl("http://localhost:8080"), "http://localhost:8080");
  assert.equal(normalizeLatticeRelayUrl("http://192.168.1.20:8080/"), "http://192.168.1.20:8080");
  for (const bad of ["ftp://x", "javascript:alert(1)", "not a url", "https://user:pw@relay.example", "https://relay.example/?q=1"]) {
    assert.throws(() => normalizeLatticeRelayUrl(bad), LatticeTransportError, bad);
  }
});

test("a cancelled request reports cancellation", async () => {
  const impl = (async (_url: string, init: RequestInit) => {
    await new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    throw new Error("unreachable");
  }) as unknown as typeof fetch;
  const transport = createLatticeRelayTransport({ deviceId: "AbC123", baseUrl: "https://signing.gridpl.us", fetchImpl: impl });
  const controller = new AbortController();
  const pending = transport.send(new Uint8Array(1), controller.signal);
  controller.abort();
  await assert.rejects(pending, /cancelled/);
});

test("a slow relay times out", async () => {
  const impl = (async (_url: string, init: RequestInit) => {
    await new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    throw new Error("unreachable");
  }) as unknown as typeof fetch;
  const transport = createLatticeRelayTransport({ deviceId: "AbC123", baseUrl: "https://signing.gridpl.us", fetchImpl: impl, timeoutMs: 20 });
  await assert.rejects(transport.send(new Uint8Array(1)), /timed out/);
});

test("an already-cancelled signal never reaches the relay", async () => {
  const { impl, calls } = fakeFetch({ status: 200, message: "00" });
  const transport = createLatticeRelayTransport({ deviceId: "AbC123", baseUrl: "https://signing.gridpl.us", fetchImpl: impl });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(transport.send(new Uint8Array(1), controller.signal), /cancelled/);
  assert.equal(calls.length, 0);
});
