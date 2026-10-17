import assert from "node:assert/strict";
import test from "node:test";
import {
  createTrezorConnectAdapter,
  type ConnectSdk,
} from "../../src/chrome/trezor/connectAdapter";
import { createTrezorConnectClient } from "../../src/chrome/trezor/connectClient";
import { captureDeviceBinding } from "../../src/chrome/trezor/deviceBinding";

const identity = "0x1111111111111111111111111111111111111111";
const path = "m/44'/60'/0'/0/0";
const device = {
  path: "device-1",
  instance: 0,
  state: { sessionId: "session", staticSessionId: "wallet" },
};
const operation = () => ({
  callId: crypto.randomUUID(),
  signal: new AbortController().signal,
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
function fixture() {
  const calls: Array<{ method: string; params: any }> = [];
  const fake = {
    init: async (params: unknown) => {
      calls.push({ method: "init", params });
    },
    cancel: (params: unknown) => {
      calls.push({ method: "cancel", params });
    },
    ethereumGetAddress: async (params: unknown) => {
      calls.push({ method: "address", params });
      return {
        success: true,
        payload: { address: identity, serializedPath: path },
        device,
      };
    },
    getFeatures: async (params: unknown) => {
      calls.push({ method: "features", params });
      return {
        success: true,
        payload: {
          model: "T3T1",
          label: "Test",
          capabilities: ["Capability_Ethereum"],
        },
        device,
      };
    },
    ethereumSignMessage: async (params: unknown) => {
      calls.push({ method: "message", params });
      return {
        success: true,
        payload: { address: identity, signature: "11".repeat(65) },
        device,
      };
    },
  };
  return {
    adapter: createTrezorConnectAdapter(fake as unknown as ConnectSdk),
    calls,
    fake,
  };
}

test("Connect 10 initializes once and binds following calls to the selected Suite wallet", async () => {
  const { adapter, calls } = fixture();
  const op = operation();
  assert.equal((await adapter.connectTrezor(() => {}, op)).deviceId, identity);
  assert.equal(calls[0].params.env, "webextension");
  assert.equal(calls[0].params.coreMode, "auto");
  assert.equal(calls[0].params.debug, false);
  assert.equal(calls[1].params.device, undefined);
  assert.equal(calls[1].params.keepSession, true);
  assert.equal(calls[2].params.keepSession, false);
  assert.deepEqual(calls[2].params.device, device);
  assert.equal(calls[2].params.callId, op.callId);
  await adapter.signTrezorMessage(
    identity,
    path,
    "0x1234",
    () => {},
    operation(),
  );
  assert.equal(calls.filter((call) => call.method === "init").length, 1);
  assert.equal(calls[3].params.device, undefined);
  assert.equal(calls[3].method, "message");
  assert.equal(calls[3].params.message, "1234");
  assert.equal(calls.length, 4, "signing must not export another address");
});

test("address scanning still rejects a different canonical wallet", async () => {
  const { adapter, calls } = fixture();
  await assert.rejects(
    adapter.scanTrezorAddresses(
      "0x2222222222222222222222222222222222222222",
      [{ hdPath: path, hdIndex: 0 }],
      () => {},
      operation(),
    ),
    /Connect the Trezor/,
  );
  assert.deepEqual(
    calls.map((call) => call.method),
    ["init", "address"],
  );
});

test("Suite binding rejects missing identity, switched wallet, path and instance", () => {
  const captured = captureDeviceBinding({
    ...device,
    secret: "never retained",
  });
  assert.deepEqual(captured, device);
  for (const value of [
    undefined,
    {},
    { ...device, state: {} },
    { ...device, path: "other" },
    { ...device, instance: 1 },
    { ...device, state: { staticSessionId: "other" } },
    { ...device, state: { sessionId: "session" } },
  ])
    assert.throws(
      () => captureDeviceBinding(value, captured),
      /wallet changed/,
    );
});

test("abort during identity lookup prevents the next SDK method", async () => {
  const { fake, calls } = fixture();
  const pending = deferred<any>();
  fake.ethereumGetAddress = async () => pending.promise;
  const adapter = createTrezorConnectAdapter(fake as unknown as ConnectSdk);
  const abort = new AbortController();
  const op = { callId: "cancel-me", signal: abort.signal };
  const result = adapter.scanTrezorAddresses(
    identity,
    [{ hdPath: path, hdIndex: 0 }],
    () => {},
    op,
  );
  await tick();
  adapter.cancel({ ...op });
  assert.equal(
    calls.some((call) => call.method === "cancel"),
    false,
  );
  abort.abort();
  adapter.cancel(op);
  pending.resolve({
    success: true,
    payload: { address: identity, serializedPath: path },
    device,
  });
  await assert.rejects(result, /cancelled/);
  assert.equal(
    calls.some((call) => call.method === "message"),
    false,
  );
  assert.equal(
    calls.find((call) => call.method === "cancel")?.params.callId,
    "cancel-me",
  );
});

test("cancel and timeout reject promptly but hold the transport slot until upstream settles", async () => {
  for (const timeout of [false, true]) {
    const { adapter } = fixture();
    const pending = deferred<any>();
    adapter.connectTrezor = async () => pending.promise;
    let cancelled = 0;
    adapter.cancel = () => {
      cancelled++;
    };
    const events: string[] = [];
    const client = createTrezorConnectClient(
      adapter,
      (_id, status) => events.push(status),
      { discovery: timeout ? 5 : 1000, signing: 1000 },
    );
    const first = client.connectTrezor("first");
    const rejection = assert.rejects(
      first,
      timeout ? /timed out/ : /cancelled/,
    );
    await tick();
    assert.equal(await client.cancelTrezorOperation("wrong"), false);
    if (!timeout)
      assert.equal(await client.cancelTrezorOperation("first"), true);
    await rejection;
    assert.equal(cancelled, 1);
    await assert.rejects(client.connectTrezor("second"), /still in progress/);
    pending.resolve({
      deviceId: identity,
      deviceLabel: "late",
      deviceModel: "T",
    });
    await tick();
    assert.deepEqual(events, ["error"]);
    adapter.connectTrezor = async () => ({
      deviceId: identity,
      deviceLabel: "ok",
      deviceModel: "T",
    });
    assert.equal((await client.connectTrezor("third")).deviceLabel, "ok");
  }
});

test("a switched Suite wallet in a later successful response is rejected", async () => {
  const { fake } = fixture();
  const features = fake.getFeatures;
  fake.getFeatures = async (params: unknown) => ({
    ...(await features(params)),
    device: {
      ...device,
      state: { ...device.state, staticSessionId: "changed-wallet" },
    },
  });
  const adapter = createTrezorConnectAdapter(fake as unknown as ConnectSdk);
  await assert.rejects(
    adapter.connectTrezor(() => {}, operation()),
    /wallet changed/,
  );
});

test("transaction and typed-data signing use one SDK call each with exact reviewed fields", async () => {
  const { fake, calls } = fixture();
  const sdk = {
    ...fake,
    ethereumSignTransaction: async (params: unknown) => {
      calls.push({ method: "transaction", params });
      return {
        success: true,
        device,
        payload: {
          v: "0x0",
          r: "11".repeat(32),
          s: "22".repeat(32),
          serializedTx: "0x01",
        },
      };
    },
    ethereumSignTypedData: async (params: unknown) => {
      calls.push({ method: "typed", params });
      return {
        success: true,
        device,
        payload: { address: identity, signature: "11".repeat(65) },
      };
    },
  };
  const adapter = createTrezorConnectAdapter(sdk as unknown as ConnectSdk);
  const transaction = {
    to: identity,
    value: "0x0",
    nonce: "0x1",
    gasLimit: "0x5208",
    maxFeePerGas: "0x3",
    maxPriorityFeePerGas: "0x1",
    chainId: 1,
  };
  await adapter.signTrezorTransaction(
    identity,
    path,
    transaction,
    () => {},
    operation(),
  );
  const tx = calls.find((call) => call.method === "transaction")!.params;
  assert.deepEqual(tx.transaction, transaction);
  assert.equal(
    tx.device,
    undefined,
    "Suite selects the wallet for the signing call",
  );
  assert.equal(tx.keepSession, false);
  const data = {
    types: { EIP712Domain: [], Test: [{ name: "value", type: "uint256" }] },
    primaryType: "Test",
    domain: {},
    message: { value: "1" },
  };
  const hash = "11".repeat(32);
  await adapter.signTrezorTypedData(
    identity,
    path,
    data,
    hash,
    hash,
    () => {},
    operation(),
  );
  const typed = calls.find((call) => call.method === "typed")!.params;
  assert.deepEqual(typed.data, data);
  assert.equal(typed.device, undefined);
  assert.equal(typed.keepSession, false);
  assert.equal(typed.metamask_v4_compat, true);
  assert.equal(typed.domain_separator_hash, hash);
  assert.equal(typed.message_hash, hash);
  assert.deepEqual(
    calls.map((call) => call.method),
    ["init", "transaction", "typed"],
  );
});

test("cancelled direct signing drops the late response without exporting an address", async () => {
  const { fake, calls } = fixture();
  const pending = deferred<any>();
  fake.ethereumSignMessage = async (params: unknown) => {
    calls.push({ method: "message", params });
    return pending.promise;
  };
  const adapter = createTrezorConnectAdapter(fake as unknown as ConnectSdk);
  const abort = new AbortController();
  const op = { callId: "cancel-direct-sign", signal: abort.signal };
  const statuses: string[] = [];
  const result = adapter.signTrezorMessage(
    identity,
    path,
    "0x12",
    (status) => statuses.push(status),
    op,
  );
  await tick();
  abort.abort();
  adapter.cancel(op);
  pending.resolve({
    success: true,
    device,
    payload: { address: identity, signature: "11".repeat(65) },
  });
  await assert.rejects(result, /cancelled/);
  assert.equal(statuses.includes("success"), false);
  assert.deepEqual(
    calls.map((call) => call.method),
    ["init", "message", "cancel"],
  );
});

test("repeated direct message signing never exports addresses or reuses a previous Suite binding", async () => {
  const { adapter, calls } = fixture();
  for (const message of ["0x01", "0x02", "0x03"]) {
    await adapter.signTrezorMessage(
      identity,
      path,
      message,
      () => {},
      operation(),
    );
  }
  assert.deepEqual(
    calls.map((call) => call.method),
    ["init", "message", "message", "message"],
  );
  assert.equal(
    new Set(calls.slice(1).map((call) => call.params.callId)).size,
    3,
  );
  for (const call of calls.slice(1)) {
    assert.equal(call.params.path, path);
    assert.equal(call.params.device, undefined);
    assert.equal(call.params.keepSession, false);
  }
});
