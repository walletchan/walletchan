import assert from "node:assert/strict";
import test from "node:test";
import { createChromeStorageHarness } from "../helpers/chromeStorageHarness";
import { migrateTabAccountStorage } from "../../src/chrome/accounts/tabSelectionRepository";
import {
  clearAllTabAccounts,
  clearAccountSelection,
  getTabAccounts,
  getTabAccount,
  setTabAccount,
} from "../../src/chrome/accounts/selectionStorage";

const id = "11111111-1111-4111-8111-111111111111";
const account = {
  id,
  type: "privateKey",
  address: `0x${"1".repeat(40)}`,
  createdAt: 1,
};

test("tab selections grow beyond sync's per-item limit without losing existing mappings", async () => {
  const legacy: Record<number, string> = {};
  for (
    let tab = 1;
    Buffer.byteLength(JSON.stringify({ ...legacy, [tab]: id })) + 11 <= 8192;
    tab++
  )
    legacy[tab] = id;
  const harness = createChromeStorageHarness({
    local: { accounts: [account] },
    sync: { tabAccounts: legacy, activeAccountId: id },
  });
  const originalSet = chrome.storage.sync.set;
  (chrome.storage.sync as any).set = async (
    values: Record<string, unknown>,
  ) => {
    for (const [key, value] of Object.entries(values)) {
      if (
        Buffer.byteLength(key) + Buffer.byteLength(JSON.stringify(value)) >
        8192
      )
        throw new Error("Resource::kQuotaBytesPerItem quota exceeded");
    }
    return originalSet(values);
  };
  try {
    await migrateTabAccountStorage();
    assert.deepEqual(await getTabAccounts(), legacy);
    assert.deepEqual(harness.stores.sync.tabAccounts, legacy);
    const nextTab = Object.keys(legacy).length + 1;
    assert.equal((await getTabAccount(nextTab))?.id, id);
    await Promise.all(
      Array.from({ length: 400 }, (_, index) =>
        setTabAccount(1000 + index, id),
      ),
    );
    const actual = await getTabAccounts();
    assert.ok(Buffer.byteLength(JSON.stringify(actual)) > 8192);
    for (const tab of Object.keys(legacy))
      assert.equal(actual[Number(tab)], id);
    assert.equal(Object.keys(actual).length, Object.keys(legacy).length + 401);
    assert.equal(
      harness.writes.some(
        (write) =>
          write.area === "sync" &&
          write.operation === "set" &&
          Object.hasOwn(write.value as object, "tabAccounts"),
      ),
      false,
    );
  } finally {
    harness.restore();
  }
});

test("failed migration preserves legacy selections; successful local commit wins over stale sync", async () => {
  const harness = createChromeStorageHarness({
    sync: { tabAccounts: { 1: id }, activeAccountId: id },
  });
  try {
    harness.failNext({ area: "local", operation: "set", key: "tabAccounts" });
    await assert.rejects(migrateTabAccountStorage());
    assert.deepEqual(harness.stores.sync.tabAccounts, { 1: id });
    assert.equal(harness.stores.local.tabAccounts, undefined);
    await migrateTabAccountStorage();
    assert.deepEqual(harness.stores.local.tabAccounts, { 1: id });
    assert.deepEqual(harness.stores.sync.tabAccounts, { 1: id });
    harness.stores.local.tabAccounts = { 2: "selected-locally" };
    await migrateTabAccountStorage();
    assert.deepEqual(await getTabAccounts(), { 2: "selected-locally" });
    assert.deepEqual(harness.stores.sync.tabAccounts, { 1: id });
    // An empty local map is authoritative and must not revive synced stale rows.
    harness.stores.local.tabAccounts = {};
    harness.stores.sync.tabAccounts = { 1: id };
    assert.deepEqual(await getTabAccounts(), {});
    await clearAllTabAccounts();
    assert.deepEqual(harness.stores.local.tabAccounts, {});
    assert.equal(harness.stores.sync.tabAccounts, undefined);
    await clearAccountSelection();
    assert.equal(harness.stores.sync.activeAccountId, undefined);
  } finally {
    harness.restore();
  }
});

test("tab map migration rejects malformed entries and never changes active selection or wallet data", async () => {
  const harness = createChromeStorageHarness({
    local: { accounts: [account], pkVault: { marker: "unchanged" } },
    sync: {
      activeAccountId: id,
      tabAccounts: {
        1: id,
        __proto__: id,
        "-1": id,
        "1e3": id,
        "2": 123,
        "3": "x".repeat(513),
      },
    },
  });
  try {
    await migrateTabAccountStorage();
    assert.deepEqual(await getTabAccounts(), { 1: id });
    assert.equal(harness.stores.sync.activeAccountId, id);
    assert.deepEqual(harness.stores.local.pkVault, { marker: "unchanged" });
    assert.deepEqual(harness.stores.local.accounts, [account]);
  } finally {
    harness.restore();
  }
});
