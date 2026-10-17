import assert from "node:assert/strict";
import test from "node:test";
import {
  BACKGROUND_TREZOR_MESSAGE_TYPES,
  createBackgroundTrezorMessageRouter,
  type BackgroundTrezorDependencies,
} from "../../src/chrome/background/trezorRouter";

function dependencies(
  overrides: Partial<BackgroundTrezorDependencies> = {},
): BackgroundTrezorDependencies {
  return {
    handleTrezorConnect: async () => ({ deviceId: "device-1" }),
    handleTrezorScan: async () => [{ address: "0x1" }],
    handleTrezorCancel: async () => ({ success: true }),
    handleAddTrezorAccounts: async () => [{ id: "trezor-1" }],
    handleGetTrezorDevices: async () => ({
      "device-1": { label: "Trezor" },
    }),
    ...overrides,
  };
}

function dispatch(
  message: Record<string, unknown>,
  overrides: Partial<BackgroundTrezorDependencies> = {},
): Promise<{ response: unknown; keepChannelOpen: boolean }> {
  return new Promise((resolve) => {
    const route = createBackgroundTrezorMessageRouter(dependencies(overrides))(
      message,
      (response) =>
        queueMicrotask(() =>
          resolve({
            response,
            keepChannelOpen: route.keepChannelOpen,
          }),
        ),
    );
    assert.equal(route.handled, true);
  });
}

test("declares an exact unique Trezor account-management route set", () => {
  assert.deepEqual(BACKGROUND_TREZOR_MESSAGE_TYPES, [
    "trezorConnect",
    "trezorScan",
    "trezorCancel",
    "addTrezorAccounts",
    "getTrezorDevices",
  ]);
  assert.equal(
    new Set(BACKGROUND_TREZOR_MESSAGE_TYPES).size,
    BACKGROUND_TREZOR_MESSAGE_TYPES.length,
  );
});

test("routes Trezor connection, scanning, storage, reads, and cancellation", async () => {
  assert.deepEqual((await dispatch({ type: "trezorConnect" })).response, {
    success: true,
    deviceId: "device-1",
  });
  assert.deepEqual((await dispatch({ type: "trezorScan" })).response, {
    success: true,
    addresses: [{ address: "0x1" }],
  });
  assert.deepEqual((await dispatch({ type: "addTrezorAccounts" })).response, {
    success: true,
    accounts: [{ id: "trezor-1" }],
    account: { id: "trezor-1" },
  });
  assert.deepEqual((await dispatch({ type: "getTrezorDevices" })).response, {
    "device-1": { label: "Trezor" },
  });
  assert.deepEqual((await dispatch({ type: "trezorCancel" })).response, {
    success: true,
  });
});

test("normalizes Trezor handler failures without leaking technical objects", async () => {
  const { response, keepChannelOpen } = await dispatch(
    { type: "trezorConnect" },
    {
      handleTrezorConnect: async () => {
        throw new Error("device unavailable");
      },
    },
  );
  assert.equal(keepChannelOpen, true);
  assert.deepEqual(response, {
    success: false,
    error: "device unavailable",
  });
});

test("does not claim unrelated messages", () => {
  const route = createBackgroundTrezorMessageRouter(dependencies())(
    { type: "unrelated" },
    () => assert.fail("unrelated messages must not respond"),
  );
  assert.deepEqual(route, { handled: false });
});
