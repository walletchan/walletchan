/** Disposable-profile quota regression. Public account metadata only; never signs. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
const build = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../build",
);
const expectedFailure = process.argv.includes("--expect-quota-error");
const profile = await mkdtemp(path.join(os.tmpdir(), "walletchan-tab-quota-"));
const server = createServer((_req, response) => {
  response.setHeader("Content-Type", "text/html");
  response.end(
    "<!doctype html><title>WalletChan connection quota QA</title><p>Isolated connection test</p>",
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [
      "--enable-unsafe-extension-debugging",
      `--disable-extensions-except=${build}`,
      `--load-extension=${build}`,
    ],
  });
  await context.route("https://**/*", (route) =>
    route.abort("blockedbyclient"),
  );
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).host;
  await worker.evaluate(async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    await chrome.storage.local.set({
      accounts: [
        {
          id,
          type: "privateKey",
          address: `0x${"1".repeat(40)}`,
          displayName: "Quota QA",
          createdAt: 1,
        },
      ],
    });
    await chrome.storage.sync.set({
      activeAccountId: id,
      address: `0x${"1".repeat(40)}`,
      displayAddress: "Quota QA",
    });
  });
  const ui = await context.newPage();
  await ui.goto(`chrome-extension://${id}/onboarding.html`);
  const dapp = await context.newPage();
  dapp.on("pageerror", (error) => console.error("dapp error:", error.message));
  dapp.on("console", (message) => {
    if (message.type() === "error")
      console.error("dapp console:", message.text());
  });
  await dapp.goto(origin);
  await dapp.waitForFunction(
    () => typeof window.ethereum?.request === "function",
  );
  const accountId = "11111111-1111-4111-8111-111111111111";
  const seeded = await worker.evaluate(
    async ({ origin, accountId }) => {
      const account = {
        id: accountId,
        type: "privateKey",
        address: `0x${"1".repeat(40)}`,
        displayName: "Quota QA",
        createdAt: 1,
      };
      const tabs = await chrome.tabs.query({});
      const tabId = tabs.find((tab) => tab.url?.startsWith(origin)).id;
      const tabAccounts = {};
      for (let index = 10000; ; index++) {
        const next = { ...tabAccounts, [index]: accountId };
        if (
          JSON.stringify(next).length + "tabAccounts".length >
          chrome.storage.sync.QUOTA_BYTES_PER_ITEM
        )
          break;
        tabAccounts[index] = accountId;
      }
      // Seed the released format after initial worker/UI startup.
      await chrome.storage.local.remove("tabAccounts");
      await chrome.storage.local.set({
        accounts: [account],
        dappPermissions: {
          [origin]: {
            origin,
            hostname: "127.0.0.1",
            approvedAt: 1,
            lastConnectedAt: 1,
          },
        },
      });
      await chrome.storage.sync.set({
        activeAccountId: accountId,
        address: account.address,
        displayAddress: account.displayName,
        tabAccounts,
      });
      return {
        tabId,
        bytes: JSON.stringify(tabAccounts).length + "tabAccounts".length,
        mappings: Object.keys(tabAccounts).length,
      };
    },
    { origin, accountId },
  );
  const result = await ui.evaluate(
    (request) => chrome.runtime.sendMessage(request),
    {
      type: "setTabAccount",
      tabId: seeded.tabId,
      accountId,
    },
  );
  if (expectedFailure) {
    assert.equal(result.success, false, JSON.stringify(result));
    assert.match(result.error, /QUOTA_BYTES_PER_ITEM|QuotaBytesPerItem/);
    console.log(JSON.stringify({ reproduced: result.error, ...seeded }));
  } else {
    assert.equal(result.success, true, JSON.stringify(result));
    const actual = await dapp.evaluate(() =>
      window.ethereum.request({ method: "eth_requestAccounts" }),
    );
    assert.deepEqual(actual, [`0x${"1".repeat(40)}`]);
    const stored = await worker.evaluate(async () => ({
      local: (await chrome.storage.local.get("tabAccounts")).tabAccounts,
      legacy: (await chrome.storage.sync.get("tabAccounts")).tabAccounts,
    }));
    assert.equal(Object.keys(stored.local).length, seeded.mappings + 1);
    assert.equal(Object.keys(stored.legacy).length, seeded.mappings);
    assert.equal(stored.local[seeded.tabId], accountId);
    // Grow beyond the old single-item limit and connect again.
    await worker.evaluate(
      async ({ accountId }) => {
        const { tabAccounts } = await chrome.storage.local.get("tabAccounts");
        for (let index = 20000; index < 20500; index++)
          tabAccounts[index] = accountId;
        await chrome.storage.local.set({ tabAccounts });
      },
      { accountId },
    );
    assert.deepEqual(
      await dapp.evaluate(() =>
        window.ethereum.request({ method: "eth_accounts" }),
      ),
      actual,
    );
    // Address visibility works for every signer type without a signing/device call.
    const walletTypes = [
      "privateKey",
      "seedPhrase",
      "ledger",
      "trezor",
      "bankr",
      "impersonator",
    ];
    for (const type of walletTypes) {
      await worker.evaluate(
        async ({ type, accountId }) => {
          const base = {
            id: accountId,
            type,
            address: `0x${"1".repeat(40)}`,
            displayName: "Quota QA",
            createdAt: 1,
          };
          const account =
            type === "ledger" || type === "trezor"
              ? {
                  ...base,
                  deviceId: `0x${"2".repeat(40)}`,
                  hdPath: "m/44'/60'/0'/0/0",
                  hdIndex: 0,
                }
              : type === "seedPhrase"
                ? { ...base, seedGroupId: "quota-qa-seed", derivationIndex: 0 }
                : base;
          await chrome.storage.local.set({ accounts: [account] });
        },
        { type, accountId },
      );
      assert.deepEqual(
        await dapp.evaluate(() =>
          window.ethereum.request({ method: "eth_accounts" }),
        ),
        actual,
        type,
      );
    }
    // A newly unapproved origin still requires explicit confirmation after migration.
    await worker.evaluate(async () => {
      await chrome.storage.local.set({ dappPermissions: {} });
    });
    await dapp.reload();
    await dapp.waitForFunction(
      () => typeof window.ethereum?.request === "function",
    );
    assert.deepEqual(
      await dapp.evaluate(() =>
        window.ethereum.request({ method: "eth_accounts" }),
      ),
      [],
    );
    await dapp.evaluate(() => {
      window.connectionPromise = window.ethereum.request({
        method: "eth_requestAccounts",
      });
    });
    let requestId;
    for (let attempt = 0; attempt < 100; attempt++) {
      const pending = await worker.evaluate(
        async () =>
          (await chrome.storage.local.get("pendingDappConnectionRequests"))
            .pendingDappConnectionRequests,
      );
      requestId = pending?.[0]?.id;
      if (requestId) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(requestId, "unapproved site must create a pending connection");
    const confirmation = await ui.evaluate(
      (request) => chrome.runtime.sendMessage(request),
      { type: "confirmDappConnection", requestId },
    );
    assert.equal(confirmation.success, true, JSON.stringify(confirmation));
    assert.deepEqual(
      await dapp.evaluate(() => window.connectionPromise),
      actual,
    );
    console.log(
      JSON.stringify({
        passed: true,
        ...seeded,
        checked: [
          "migration",
          "account selection",
          "eth_requestAccounts",
          "eth_accounts",
          "growth beyond sync limit",
          "all five signer types and view-only",
          "explicit connection approval",
        ],
      }),
    );
  }
} finally {
  await context?.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
