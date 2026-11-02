/**
 * Lattice account-domain behaviour in the background: setup, pairing, commit,
 * encrypted pairing key, vault integrity, signing and its fail-closed guards.
 * Runs against the in-process Lattice simulator through a relay fetch stub.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  recoverMessageAddress,
  recoverTransactionAddress,
  recoverTypedDataAddress,
  type Address,
} from "viem";

import { createChromeStorageHarness } from "../helpers/chromeStorageHarness";
import { FakeLattice } from "./fakeLattice";
import { installRelayFetch } from "./relayFetch";

const CANONICAL = [0x8000002c, 0x8000003c, 0x80000000, 0, 0];
const bip44 = (index: number) => [0x8000002c, 0x8000003c, 0x80000000, 0, index];
const TO = "0x000000000000000000000000000000000000dEaD" as Address;

async function loadModules() {
  return {
    ops: await import("../../src/chrome/lattice/operations"),
    storage: await import("../../src/chrome/lattice/storage"),
    keys: await import("../../src/chrome/lattice/appKeyVault"),
    signing: await import("../../src/chrome/lattice/signing"),
    errors: await import("../../src/chrome/lattice/errors"),
    repository: await import("../../src/chrome/accounts/repository"),
    session: await import("../../src/chrome/sessionCache"),
    crypto: await import("../../src/chrome/crypto"),
    integrity: await import("../../src/chrome/vault/generalIntegrity"),
  };
}

test("Lattice background domain", async (t) => {
  const harness = createChromeStorageHarness({ local: { accounts: [] } });
  const device = new FakeLattice({ paired: false, pairingCode: "K7Q2M9XZ" });
  const devices: Record<string, FakeLattice> = { ABC123: device };
  const relay = installRelayFetch(devices);
  const m = await loadModules();
  const vaultKeyBytes = crypto.getRandomValues(new Uint8Array(32));
  const vaultKey = await m.crypto.importVaultKey(vaultKeyBytes);
  m.session.setCachedVaultKey(vaultKey);
  t.after(() => {
    m.session.setCachedVaultKey(null);
    m.ops.clearLatticeSetup();
    relay.restore();
    harness.restore();
  });

  const deviceId = device.addressFor(CANONICAL).toLowerCase();
  let appKey: Uint8Array;

  await t.test("setup pairs a new Lattice and identifies the wallet by its canonical address", async () => {
    const first = await m.ops.connectLatticeForSetup({ opId: "op-connect", relayDeviceId: "ABC123", endpoint: null });
    assert.deepEqual(first, { needsPairing: true });
    await assert.rejects(
      m.ops.pairLatticeForSetup({ opId: "op-pair-bad", pairingCode: "WRONG000" }),
      (error: unknown) => error instanceof m.errors.LatticeError && error.code === "PAIRING_FAILED",
    );
    const paired = await m.ops.pairLatticeForSetup({ opId: "op-pair", pairingCode: "k7q2m9xz" });
    assert.equal(paired.deviceId, deviceId);
    assert.equal(paired.walletKind, "internal");
    assert.equal(paired.deviceModel, "Lattice1");
    assert.equal(device.pairedAppName, "WalletChan");
    assert.ok(relay.urls.every((url) => url === "https://signing.gridpl.us/ABC123"));
    const statuses = harness.runtimeMessages
      .filter((message: any) => message.type === "latticeStatus" && message.opId === "op-connect")
      .map((message: any) => message.status);
    assert.deepEqual(statuses, ["connecting", "awaiting-pairing"]);
  });

  await t.test("scan returns device addresses and the commit only accepts scanned ones", async () => {
    const rows = await m.ops.scanLatticeAddresses({ opId: "op-scan", deviceId, startIndex: 0, count: 3, scheme: "bip44" });
    assert.deepEqual(rows.map((row) => row.address), [0, 1, 2].map((i) => device.addressFor(bip44(i))));
    assert.deepEqual(rows.map((row) => row.hdPath), [0, 1, 2].map((i) => `m/44'/60'/0'/0/${i}`));
    const setup = m.ops.getLatticeSetupForCommit(deviceId);
    assert.equal(setup.appKeyIsNew, true);
    assert.equal(setup.resolveScanned(device.addressFor(bip44(9))), null);
    assert.deepEqual(setup.resolveScanned(rows[1].address.toLowerCase()), { hdPath: "m/44'/60'/0'/0/1", hdIndex: 1 });
    assert.throws(() => m.ops.getLatticeSetupForCommit(TO), /setup changed/);
  });

  await t.test("commit writes accounts, the public device row and the encrypted key in one write", async () => {
    const setup = m.ops.getLatticeSetupForCommit(deviceId);
    appKey = setup.appKey;
    harness.clearObservations();
    const created = await m.storage.addLatticeAccounts(
      {
        deviceId,
        deviceLabel: "Lattice1 · ABC123",
        deviceModel: "Lattice1",
        relayDeviceId: setup.relayDeviceId,
        endpoint: setup.endpoint,
        walletUid: setup.walletUid,
        walletKind: setup.walletKind,
        addresses: [0, 1].map((i) => ({
          address: device.addressFor(bip44(i)),
          ...setup.resolveScanned(device.addressFor(bip44(i)))!,
        })),
        newAppKey: await m.keys.encryptLatticeAppKey(vaultKey, setup.appKey),
      },
      "",
    );
    m.ops.clearLatticeSetup();
    assert.equal(created.length, 2);
    const localWrites = harness.writes.filter((write) => write.area === "local");
    assert.equal(localWrites.length, 1);
    assert.deepEqual(Object.keys(localWrites[0].value as object).sort(), ["accounts", "latticeAppKeyVault", "latticeDevices"]);
    const row = (harness.stores.local.latticeDevices as Record<string, any>)[deviceId];
    assert.equal(row.relayDeviceId, "ABC123");
    assert.equal(row.endpoint, null);
    assert.match(row.walletUid, /^0x[0-9a-f]{64}$/);
    const stored = harness.stores.local.latticeAppKeyVault as Record<string, unknown>;
    assert.equal(stored.version, 1);
    assert.ok(!JSON.stringify(stored).includes(Buffer.from(appKey).toString("hex")));
    const accounts = await m.repository.getAccounts();
    assert.deepEqual(accounts.map((account) => account.type), ["lattice", "lattice"]);
    assert.deepEqual(await m.keys.loadLatticeAppKey(), appKey);
  });

  await t.test("vault integrity proves the pairing key is recoverable before factor changes", async () => {
    assert.deepEqual(await m.integrity.validateGeneralVaultMasterRecovery(vaultKeyBytes, "unused"), { success: true });
    const saved = harness.stores.local.latticeAppKeyVault;
    const otherKey = await m.crypto.importVaultKey(crypto.getRandomValues(new Uint8Array(32)));
    harness.stores.local.latticeAppKeyVault = await m.keys.encryptLatticeAppKey(otherKey, appKey);
    assert.deepEqual(await m.integrity.validateGeneralVaultMasterRecovery(vaultKeyBytes, "unused"), {
      success: false,
      error: "Lattice pairing key could not be recovered",
    });
    delete harness.stores.local.latticeAppKeyVault;
    assert.deepEqual(await m.integrity.validateGeneralVaultMasterRecovery(vaultKeyBytes, "unused"), {
      success: false,
      error: "A Lattice account is missing its pairing key",
    });
    harness.stores.local.latticeAppKeyVault = saved;
  });

  await t.test("signing reuses the stored key and recovers every result to the pinned account", async () => {
    const [account] = (await m.repository.getAccounts()) as any[];
    const tx = {
      type: "eip1559" as const, chainId: 1, nonce: 4, to: TO, value: 5n, gas: 21_000n,
      maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000n,
    };
    const signedTx = await m.signing.signPreparedLatticeTransaction({ opId: "tx-1", account, transaction: tx });
    assert.equal(await recoverTransactionAddress({ serializedTransaction: signedTx as never }), account.address);

    const message = "0x48656c6c6f";
    const personal = await m.signing.signLatticeSignatureRequest({
      opId: "sig-1", account, method: "personal_sign", params: [message, account.address], chainId: 1,
    });
    assert.equal(await recoverMessageAddress({ message: { raw: message }, signature: personal }), account.address);

    const typedData = {
      domain: { chainId: 1, verifyingContract: TO },
      types: {
        SafeTx: [
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
        ],
      },
      primaryType: "SafeTx",
      message: { to: TO, value: "0", nonce: "7" },
    };
    harness.clearObservations();
    const typed = await m.signing.signLatticeTypedDataForAccount({ opId: "safe-1", account, typedData, chainId: 1 });
    assert.equal(await recoverTypedDataAddress({ ...typedData, signature: typed } as never), account.address);
    assert.ok(harness.runtimeMessages.some((message: any) => message.opId === "safe-1" && message.status === "awaiting-confirmation"));
    await assert.rejects(
      m.signing.signLatticeTypedDataForAccount({ opId: "safe-2", account, typedData, chainId: 10 }),
      /must match the active chainId/,
    );
  });

  await t.test("signing fails closed on a swapped SafeCard, a lost pairing and a locked wallet", async () => {
    const [account] = (await m.repository.getAccounts()) as any[];
    const run = (opId: string) =>
      m.signing.signLatticeSignatureRequest({ opId, account, method: "personal_sign", params: ["0x01"], chainId: 1 });
    device.setSafeCard(true);
    await assert.rejects(run("guard-1"), /Remove the SafeCard/);
    device.setSafeCard(false);

    devices.ABC123 = new FakeLattice({ paired: false });
    await assert.rejects(
      run("guard-2"),
      (error: unknown) => error instanceof m.errors.LatticeError && error.code === "NOT_PAIRED",
    );
    devices.ABC123 = device;

    m.session.setCachedVaultKey(null);
    await assert.rejects(
      run("guard-3"),
      (error: unknown) => error instanceof m.errors.LatticeError && error.code === "WALLET_LOCKED",
    );
    m.session.setCachedVaultKey(vaultKey);

    delete devices.ABC123;
    await assert.rejects(
      run("guard-4"),
      (error: unknown) => error instanceof m.errors.LatticeError && error.code === "DEVICE_OFFLINE",
    );
    devices.ABC123 = device;
  });

  await t.test("one device operation at a time, and cancel aborts the active one", async () => {
    const [account] = (await m.repository.getAccounts()) as any[];
    const gate = relay.hold();
    const first = m.signing.signLatticeSignatureRequest({
      opId: "busy-1", account, method: "personal_sign", params: ["0x02"], chainId: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await assert.rejects(
      m.signing.signLatticeSignatureRequest({ opId: "busy-2", account, method: "personal_sign", params: ["0x03"], chainId: 1 }),
      (error: unknown) => error instanceof m.errors.LatticeError && error.code === "DEVICE_BUSY",
    );
    await m.ops.cancelLatticeOperation("not-active");
    await m.ops.cancelLatticeOperation("busy-1");
    await assert.rejects(first, (error: unknown) => error instanceof m.errors.LatticeError && error.code === "CANCELLED");
    gate.release();
    const after = await m.signing.signLatticeSignatureRequest({
      opId: "busy-3", account, method: "personal_sign", params: ["0x04"], chainId: 1,
    });
    assert.match(after, /^0x[0-9a-f]{130}$/);
  });

  await t.test("a second Lattice reuses the stored key, and a self-hosted endpoint is stored per device", async () => {
    const second = new FakeLattice({ paired: false, pairingCode: "ZZZZ9999", safeCardInserted: true });
    devices.XYZ789 = second;
    const before = relay.urls.length;
    const connected = await m.ops.connectLatticeForSetup({
      opId: "op-second", relayDeviceId: "XYZ789", endpoint: "http://localhost:8080/",
    });
    assert.deepEqual(connected, { needsPairing: true });
    assert.equal(relay.urls[before], "http://localhost:8080/XYZ789");
    const paired = await m.ops.pairLatticeForSetup({ opId: "op-second-pair", pairingCode: "ZZZZ9999" });
    assert.equal(paired.walletKind, "safecard");
    const setup = m.ops.getLatticeSetupForCommit(paired.deviceId);
    assert.equal(setup.appKeyIsNew, false);
    assert.deepEqual(setup.appKey, appKey);
    assert.equal(setup.endpoint, "http://localhost:8080");
    m.ops.clearLatticeSetup();
    await assert.rejects(
      m.storage.addLatticeAccounts(
        {
          deviceId: paired.deviceId, deviceLabel: "x", deviceModel: "Lattice1", relayDeviceId: "XYZ789",
          endpoint: null, walletUid: setup.walletUid, walletKind: "safecard",
          addresses: [{ address: second.addressFor(bip44(0)), hdPath: "m/44'/60'/0'/0/0", hdIndex: 0 }],
          newAppKey: await m.keys.encryptLatticeAppKey(vaultKey, appKey),
        },
        "",
      ),
      /setup changed while pairing/,
    );
  });

  await t.test("removing the last Lattice account removes its device row and the pairing key", async () => {
    harness.stores.local.accounts = [];
    await m.storage.removeLatticeDeviceIfUnused(deviceId);
    assert.equal((harness.stores.local.latticeDevices as Record<string, unknown>)[deviceId], undefined);
    assert.equal(harness.stores.local.latticeAppKeyVault, undefined);
  });
});

test("Lattice account rows decode exactly at the repository boundary", async () => {
  const { decodeLatticeAccount, isReleasedLatticePath } = await import("../../src/chrome/lattice/codecs");
  const row = {
    id: "a", type: "lattice", address: "0x1111111111111111111111111111111111111111",
    deviceId: "0x2222222222222222222222222222222222222222", hdPath: "m/44'/60'/3'/0/0", hdIndex: 3, createdAt: 1,
  };
  assert.equal(decodeLatticeAccount(row).hdIndex, 3);
  assert.equal(isReleasedLatticePath("m/44'/60'/0'/0/7", 7), true);
  assert.equal(isReleasedLatticePath("m/44'/60'/0'/0/7", 6), false);
  for (const bad of [
    { ...row, extra: true },
    { ...row, hdIndex: 4 },
    { ...row, hdPath: "m/44'/60'/0'/0/0/0" },
    { ...row, deviceId: "device" },
    { ...row, type: "ledger" },
    { ...row, createdAt: -1 },
  ]) {
    assert.throws(() => decodeLatticeAccount(bad), /Invalid Lattice account storage/);
  }
});
