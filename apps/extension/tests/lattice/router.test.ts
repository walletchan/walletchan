import assert from "node:assert/strict";
import test from "node:test";

import {
  BACKGROUND_LATTICE_MESSAGE_TYPES,
  createBackgroundLatticeMessageRouter,
} from "../../src/chrome/background/latticeRouter";
import { classifyBackgroundMessage } from "../../src/chrome/background/messageAccessPolicy";

function dependencies(overrides = {}) {
  return {
    handleLatticeConnect: async () => ({ needsPairing: true }),
    handleLatticePair: async () => ({ deviceId: "device-1" }),
    handleLatticeScan: async () => [{ address: "0x1" }],
    handleLatticeCancel: async () => ({ success: true }),
    handleAddLatticeAccounts: async () => [{ id: "a" }],
    handleGetLatticeDevices: async () => ({ device: {} }),
    ...overrides,
  };
}

async function dispatch(message: Record<string, unknown>, overrides = {}) {
  let response: unknown;
  const done = new Promise<void>((resolve) => {
    const route = createBackgroundLatticeMessageRouter(dependencies(overrides) as never)(message, (value) => {
      response = value;
      resolve();
    });
    assert.deepEqual(route, { handled: true, keepChannelOpen: true });
  });
  await done;
  return response;
}

test("Lattice router manifest is exact and wallet-UI only", () => {
  assert.deepEqual(BACKGROUND_LATTICE_MESSAGE_TYPES, [
    "latticeConnect", "latticePair", "latticeScan", "latticeCancel", "addLatticeAccounts", "getLatticeDevices",
  ]);
  for (const type of BACKGROUND_LATTICE_MESSAGE_TYPES) {
    assert.equal(classifyBackgroundMessage(type), "wallet-ui", type);
  }
  assert.equal(classifyBackgroundMessage("confirmTransactionAsyncLattice"), "wallet-ui");
});

test("Lattice router shapes responses and errors", async () => {
  assert.deepEqual(await dispatch({ type: "latticeConnect" }), { success: true, needsPairing: true });
  assert.deepEqual(await dispatch({ type: "latticePair" }), { success: true, deviceId: "device-1" });
  assert.deepEqual(await dispatch({ type: "latticeScan" }), { success: true, addresses: [{ address: "0x1" }] });
  assert.deepEqual(await dispatch({ type: "addLatticeAccounts" }), { success: true, accounts: [{ id: "a" }], account: { id: "a" } });
  assert.deepEqual(
    await dispatch({ type: "latticePair" }, { handleLatticePair: async () => { throw new Error("Pairing failed."); } }),
    { success: false, error: "Pairing failed." },
  );
  const route = createBackgroundLatticeMessageRouter(dependencies() as never)({ type: "ledgerConnect" }, () => undefined);
  assert.deepEqual(route, { handled: false });
});
