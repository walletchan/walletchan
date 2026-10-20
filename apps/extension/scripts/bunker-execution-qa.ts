import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPublicClient, http, parseAbi, type Hex } from "viem";
import { completeQaOnboarding } from "./extension-onboarding-qa-support";

const port = 20400 + process.pid % 1000, rpc = `http://127.0.0.1:${port}`;
const node = spawn("anvil", ["--port", String(port), "--host", "127.0.0.1", "--chain-id", "11155111", "--silent"], { stdio: "ignore" });
const client = createPublicClient({ cacheTime: 0, transport: http(rpc, { retryCount: 0 }) });
// Disposable compatibility proxy: never touches the user's configured browser/profile.
let rejectLatestBlock = false, fallbackReads = 0, confirming = false, holdGasEstimates = false;
const heldGasEstimates: (() => void)[] = [];
const proxyRpc = `http://127.0.0.1:${port + 1000}`;
const proxy = createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString(), request = JSON.parse(body);
    if (request.method === "eth_blockNumber" || (rejectLatestBlock && request.method === "eth_getBlockByNumber" && request.params?.[0] === "latest")) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "fixture method unavailable" } }));
      return;
    }
    if (request.method === "eth_getBlockByNumber" && request.params?.[0] === "latest") fallbackReads++;
    if (holdGasEstimates && request.method === "eth_estimateGas") await new Promise<void>(resolve => heldGasEstimates.push(resolve));
    if (confirming && ["eth_call", "eth_sendRawTransaction"].includes(request.method)) await new Promise(resolve => setTimeout(resolve, 600));
    const upstream = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body });
    res.writeHead(upstream.status, { "content-type": "application/json" });
    res.end(await upstream.text());
  } catch { res.writeHead(503); res.end(); }
});
await new Promise<void>((resolve) => proxy.listen(port + 1000, "127.0.0.1", resolve));
const profile = await mkdtemp(path.join(os.tmpdir(), "bunker-execution-"));
const out = "/tmp/bunker-execution-qa"; await mkdir(out, { recursive: true });
const build = path.resolve("build"), errors: string[] = [];
const context = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, ignoreDefaultArgs: ["--disable-extensions"], viewport: { width: 420, height: 800 },
  args: [`--disable-extensions-except=${build}`, `--load-extension=${build}`, "--disable-background-timer-throttling", "--disable-renderer-backgrounding"] });
context.on("page", (page) => page.on("pageerror", (e) => errors.push(e.message)));
try {
  let ready = false;
  for (let i = 0; i < 50; i++) { try { await client.getChainId(); ready = true; break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  assert.ok(ready);
  for (const name of ["factory", "singleton", "multiSend", "Safe4337Module", "SafeModuleSetup", "EntryPoint"]) {
    const fixture = JSON.parse(await readFile(new URL(`../tests/safeBunker/fixtures/${name}.json`, import.meta.url), "utf8"));
    await client.request({ method: "anvil_setCode" as any, params: [fixture.address, fixture.runtime] as any });
  }
  // Let Chromium finish registering unpacked extensions before reading its worker.
  const extensionManager = await context.newPage();
  await extensionManager.goto("chrome://extensions/");
  await extensionManager.locator("extensions-item").waitFor();
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host, page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/onboarding.html`);
  await completeQaOnboarding(page, { wallet: "privateKey", password: "bunker-qa-synthetic-master", privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", bankrApiKey: "unused-synthetic" });
  await page.evaluate(async (rpc) => {
    const { networksInfo = {} } = await chrome.storage.sync.get("networksInfo");
    await chrome.storage.sync.set({ networksInfo: { ...networksInfo, "Ethereum Sepolia": { chainId: 11155111, rpcUrl: rpc } } });
    await chrome.runtime.sendMessage({ type: "setSidePanelMode", enabled: false });
  }, proxyRpc);
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await page.getByRole("button", { name: "Lock wallet" }).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Choose account", exact: true }).click();
  await page.getByRole("button", { name: "Add account", exact: true }).first().click();
  await page.getByRole("button", { name: /Safe Bunker/ }).click();
  await page.getByRole("button", { name: "Proceed", exact: true }).click();
  await page.getByRole("button", { name: "Create or import a seed phrase", exact: true }).click();
  await page.getByRole("button", { name: "Create new seed phrase", exact: true }).click();
  await page.getByRole("button", { name: "Choose network", exact: true }).click();
  await page.getByRole("button", { name: /Ethereum Sepolia/ }).click();
  await page.getByText("Safe address", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("heading", { name: "Deploy Bunker", exact: true }).waitFor();
  await page.getByRole("button", { name: "Choose account", exact: true }).click();
  await page.getByRole("menuitem").first().click();
  assert.equal(await page.getByRole("combobox").count(), 0);
  assert.equal(await page.getByRole("checkbox", { name: /default/ }).count(), 0);
  await page.screenshot({ path: `${out}/gas-payer-picker.png`, fullPage: true });
  await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some(b => b.textContent === "Deploy" && !b.disabled));
  await page.screenshot({ path: `${out}/deployment-review.png`, fullPage: true });
  await page.getByRole("button", { name: "Deploy", exact: true }).click();
  await page.getByRole("button", { name: "Back up your wallet", exact: true }).waitFor({ timeout: 30000 });
  assert.ok(await page.getByRole("tab", { name: "Activity", exact: true }).getAttribute("aria-selected") === "true");
  await client.request({ method: "anvil_mine" as any, params: ["0x3"] as any });
  await page.evaluate(async () => {
    const { accounts } = await chrome.storage.local.get("accounts");
    const account = accounts.find((a: any) => a.type === "safeBunker");
    const response = await chrome.runtime.sendMessage({ type: "reconcileSafeBunker", id: account.bunkerId });
    if (!response.success) throw new Error(response.error);
  });
  await page.getByRole("button", { name: "Choose account", exact: true }).waitFor({ timeout: 30000 });
  const account = await page.evaluate(async () => (await chrome.storage.local.get("accounts")).accounts.find((a: any) => a.type === "safeBunker"));
  assert.ok(account);
  // A second synthetic local account exercises the anchored payer menu.
  const alternate = await page.evaluate(async () => chrome.runtime.sendMessage({ type: "addPrivateKeyAccount",
    privateKey: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", displayName: "Alternate payer" }));
  assert.ok(alternate.success, JSON.stringify(alternate));
  await client.request({ method: "anvil_setBalance" as any, params: [account.address, "0x16345785d8a0000"] as any });
  const readOwner = () => client.readContract({ address: account.address as Hex, abi: parseAbi(["function getOwners() view returns(address[])"]), functionName: "getOwners" });
  const before = await readOwner();
  await page.evaluate(() => {
    (window as any).__bunkerManagementFlashes = [];
    new MutationObserver(() => {
      for (const heading of document.querySelectorAll("h1,h2,h3")) {
        if (heading.textContent === "Bunker requests") (window as any).__bunkerManagementFlashes.push(heading.textContent);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  // Hold view responses to exercise the escape path while the body stays a skeleton.
  await page.evaluate(() => {
    const runtime = chrome.runtime as any, send = runtime.sendMessage.bind(runtime);
    (window as any).__heldBunkerViews = [];
    (window as any).__restoreBunkerMessages = () => { runtime.sendMessage = send; };
    runtime.sendMessage = (...args: any[]) => {
      const response = send(...args);
      if (args[0]?.type !== "getSafeBunkerView") return response;
      return new Promise(resolve => Promise.resolve(response).then(value => (window as any).__heldBunkerViews.push(() => resolve(value))));
    };
  });
  rejectLatestBlock = true;
  const queued = await page.evaluate(async (accountId) => chrome.runtime.sendMessage({ type: "createSafeBunkerRequest", id: "qa-transfer", accountId, chainId: 11155111,
    calls: [{ to: "0x1111111111111111111111111111111111111111", value: "1000000000000000", data: "0x", operation: 0 }] }), account.id);
  assert.ok(queued.success);
  // Incoming requests open the shared transaction confirmation, with automatic fee preparation.
  await page.getByRole("heading", { name: "Transaction request", exact: true }).waitFor({ timeout: 30000 });
  assert.equal(await page.getByRole("heading", { name: "Bunker requests", exact: true }).count(), 0);
  await page.getByRole("status", { name: "Loading request", exact: true }).waitFor();
  await page.waitForFunction(() => (window as any).__heldBunkerViews.length > 0);
  assert.ok(await page.getByRole("button", { name: "Go back", exact: true }).isEnabled());
  await page.waitForFunction(() => Math.abs(document.querySelector('[aria-label="Loading request"]')!.getBoundingClientRect().x) < 1);
  await page.screenshot({ path: `${out}/request-loading-with-back.png`, fullPage: true });
  await page.getByRole("button", { name: "Go back", exact: true }).click();
  await page.getByRole("button", { name: "Choose account", exact: true }).waitFor();
  await page.getByRole("heading", { name: "Transaction request", exact: true }).waitFor({ state: "hidden" });
  await page.evaluate(() => {
    (window as any).__restoreBunkerMessages();
    for (const release of (window as any).__heldBunkerViews) release();
  });
  assert.ok(await page.getByRole("button", { name: "Choose account", exact: true }).isVisible(), "late loading replies leave Home navigation intact");
  await page.getByRole("button", { name: "1 Pending Request", exact: true }).click();
  await page.getByRole("button", { name: "Choose gas payer", exact: true }).click();
  await page.getByRole("menuitem").filter({ hasText: /0xf39/i }).click();
  const rpcError = page.getByText("The selected RPC could not provide the latest block number using eth_blockNumber or eth_getBlockByNumber. Retry or change the RPC in Network settings.", { exact: true });
  await rpcError.waitFor({ timeout: 30000 });
  assert.ok(await page.getByRole("button", { name: "Confirm", exact: true }).isDisabled());
  await page.screenshot({ path: `${out}/rpc-unavailable.png`, fullPage: true });
  assert.deepEqual(await page.evaluate(() => (window as any).__bunkerManagementFlashes), [], "incoming request never paints management loading");
  const retryFee = page.getByRole("button", { name: "Retry", exact: true });
  for (const width of [320, 420]) {
    await page.setViewportSize({ width, height: 800 });
    const retryBox = await retryFee.boundingBox(), errorBox = await rpcError.boundingBox();
    assert.ok(retryBox && errorBox && retryBox.x >= errorBox.x + errorBox.width && retryBox.y < errorBox.y + errorBox.height, "fee retry sits to the right of its error");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.screenshot({ path: `${out}/fee-error-row-${width}.png`, fullPage: true });
  }
  assert.equal(await retryFee.locator("svg").count(), 1, "retry has a leading icon");
  await page.screenshot({ path: `${out}/fee-error-retry-button.png`, fullPage: true });
  rejectLatestBlock = false;
  await retryFee.click();
  await rpcError.waitFor({ state: "hidden" });
  await page.reload();
  await page.getByRole("heading", { name: "Transaction request", exact: true }).waitFor({ timeout: 30000 });
  const confirm = page.getByRole("button", { name: "Confirm", exact: true });
  await confirm.waitFor();
  // Asset-preview unavailability is informational and never needs acknowledgment.
  for (let i = 0; i < 60 && !await confirm.isEnabled(); i++) {
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.ok(await confirm.isEnabled(), "reviewed valid execution can be confirmed without acknowledging preview availability");
  assert.equal(await page.getByRole("checkbox", { name: /asset preview/i }).count(), 0);
  await page.screenshot({ path: `${out}/preview-without-checkbox.png`, fullPage: true });
  // Pending requests use the ordinary Home banner and extension toolbar badge.
  await page.getByRole("button", { name: "Go back", exact: true }).click();
  await page.getByRole("button", { name: "Choose account", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Requests & security", exact: true }).count(), 0);
  const banner = page.getByRole("button", { name: "1 Pending Request", exact: true });
  await banner.waitFor({ timeout: 30000 });
  await page.waitForFunction(async () => (await chrome.action.getBadgeText({})) === "1");
  await page.getByRole("heading", { name: "Transaction request", exact: true }).waitFor({ state: "hidden" });
  await page.screenshot({ path: `${out}/home-pending-banner.png`, fullPage: true });
  await banner.click();
  await page.getByRole("heading", { name: "Transaction request", exact: true }).waitFor();
  for (let i = 0; i < 60 && !await confirm.isEnabled(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  // Footer reuses the wallet's anchored gas chooser, with automatic re-review.
  await page.getByRole("button", { name: /^Gas fee/ }).click();
  await page.getByRole("button", { name: /^Fast/ }).click();
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((button) => button.textContent === "Confirm" && !button.disabled));
  await page.getByRole("button", { name: /^Gas fee/ }).click();
  await page.getByRole("button", { name: /^Normal/ }).click();
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((button) => button.textContent === "Confirm" && !button.disabled));
  // Reload resumes this durable request directly, without visiting request management.
  await page.reload();
  await page.getByRole("heading", { name: "Transaction request", exact: true }).waitFor({ timeout: 30000 });
  for (let i = 0; i < 60 && !await confirm.isEnabled(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(await confirm.isEnabled(), "cold request resumes with its payer and fresh review");
  const payerMenu = page.getByRole("button", { name: "Choose gas payer", exact: true });
  const rememberPayer = page.getByRole("checkbox", { name: "set default payer for future", exact: true });
  assert.equal(await rememberPayer.count(), 0, "saved default needs no checkbox or badge");
  assert.equal(await page.getByRole("button", { name: "Refresh fee", exact: true }).count(), 0);
  await payerMenu.click();
  await page.getByRole("menuitem").filter({ hasText: "Alternate payer" }).click();
  await rememberPayer.waitFor();
  assert.ok(!await rememberPayer.isChecked(), "changing payer never opts in automatically");
  await page.getByText("set default payer for future", { exact: true }).click();
  assert.ok(await rememberPayer.isChecked());
  const checkboxStyle = await rememberPayer.evaluate(el => {
    const label = el.closest("label")!;
    return { height: label.getBoundingClientRect().height };
  });
  assert.ok(checkboxStyle.height <= 24, "default payer control has no oversized top/bottom space");
  await payerMenu.click();
  await page.getByRole("menuitem").filter({ hasText: /0xf39/i }).click();
  assert.equal(await rememberPayer.count(), 1, "deployment payer was not saved as a transaction default");
  const alternateAddress = await page.evaluate(async () => (await chrome.runtime.sendMessage({ type: "getAccounts" })).find((a: any) => a.displayName === "Alternate payer").address);
  await client.request({ method: "anvil_setBalance" as any, params: [alternateAddress, "0x0"] as any });
  await payerMenu.click();
  await page.getByRole("menuitem").filter({ hasText: "Alternate payer" }).click();
  await page.getByText("Gas payer has insufficient Sepolia ETH", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Retry", exact: true }).count(), 0, "insufficient funds offers no ineffective retry");
  await page.screenshot({ path: `${out}/insufficient-payer-no-retry.png`, fullPage: true });
  await client.request({ method: "anvil_setBalance" as any, params: [alternateAddress, "0x3635c9adc5dea00000"] as any });
  await payerMenu.click();
  await page.getByRole("menuitem").filter({ hasText: /0xf39/i }).click();
  await page.getByRole("heading", { name: "Transaction request", exact: true }).click();
  await page.getByRole("menu").waitFor({ state: "hidden" });
  for (let i = 0; i < 60 && !await confirm.isEnabled(); i++) await new Promise(resolve => setTimeout(resolve, 500));
  const matrix: unknown[] = [];
  for (const theme of ["midnight", "bauhaus"]) {
    await page.evaluate((theme) => chrome.storage.local.set({ selectedThemeId: theme }), theme);
    for (const width of [320, 420, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await page.getByRole("button", { name: "Choose gas payer", exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${out}/${theme}-${width}-request.png`, fullPage: true });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      const axe = await new AxeBuilder({ page }).analyze();
      assert.deepEqual(axe.violations.filter((v) => ["serious", "critical"].includes(v.impact ?? "")).map((v) => ({ id: v.id, targets: v.nodes.map((n) => ({ target: n.target, html: n.html, summary: n.failureSummary })) })), []);
      matrix.push({ theme, width, axe: "pass" });
    }
  }
  // Regression: submit the head of two requests, then open the remaining approval
  // before the three-confirmation settlement gate has completed.
  const second = await page.evaluate(async (accountId) => chrome.runtime.sendMessage({ type: "createSafeBunkerRequest", id: "qa-after-submit", accountId, chainId: 11155111,
    calls: [{ to: "0x3333333333333333333333333333333333333333", value: "2000000000000000", data: "0x", operation: 0 }] }), account.id);
  assert.ok(second.success);
  await page.getByText("1/2", { exact: true }).waitFor();
  for (let i = 0; i < 60 && !await confirm.isEnabled(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await page.getByText("set default payer for future", { exact: true }).click();
  confirming = true;
  await confirm.click();
  await page.getByRole("button", { name: /Checking…/ }).waitFor({ timeout: 10000 });
  await page.screenshot({ path: `${out}/confirm-checking.png`, fullPage: true });
  await page.getByRole("button", { name: /Broadcasting…/ }).waitFor({ timeout: 10000 });
  await page.screenshot({ path: `${out}/confirm-broadcasting.png`, fullPage: true });
  // Submission returns directly to the Bunker's normal Home Activity tab.
  await page.getByRole("button", { name: "Choose account", exact: true }).waitFor({ timeout: 30000 });
  confirming = false;
  await page.getByRole("tab", { name: /Activity/ }).waitFor();
  assert.equal(await page.getByRole("tab", { name: /Activity/ }).getAttribute("aria-selected"), "true");
  await page.waitForFunction(async () => (await chrome.action.getBadgeText({})) === "1");
  const remainingBanner = page.getByRole("button", { name: "1 Pending Request", exact: true });
  await remainingBanner.waitFor();
  await remainingBanner.click();
  await page.getByText("Waiting for the previous transaction to confirm.", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Retry exact transaction", exact: true }).count(), 0);
  assert.ok(await confirm.isDisabled());
  await page.getByText(/0.002/).first().waitFor();
  assert.equal(await page.getByText("1/2", { exact: true }).count(), 0);
  await page.screenshot({ path: `${out}/remaining-request-before-settlement.png`, fullPage: true });
  // The waiting request can still be rejected without touching the submitted one.
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await page.getByRole("button", { name: "Choose account", exact: true }).waitFor();
  await page.waitForFunction(async () => (await chrome.action.getBadgeText({})) === "");
  await page.getByRole("button", { name: "Open transaction details for Send 0.001 ETH", exact: true }).waitFor({ timeout: 30000 });
  await client.request({ method: "anvil_mine" as any, params: ["0x3"] as any });
  await page.evaluate(async (id) => chrome.runtime.sendMessage({ type: "reconcileSafeBunker", id }), account.bunkerId);
  assert.notDeepEqual(await readOwner(), before);
  assert.equal(await client.getBalance({ address: "0x1111111111111111111111111111111111111111" }), 1000000000000000n);
  await page.screenshot({ path: `${out}/confirmed.png`, fullPage: true });
  await page.getByRole("button", { name: "Open transaction details for Send 0.001 ETH", exact: true }).click();
  await page.getByRole("heading", { name: "Transaction details", exact: true }).waitFor();
  await page.getByText("Transaction summary", { exact: true }).waitFor();
  assert.equal(await page.getByText("Bunker execution", { exact: true }).count(), 0);
  const rotation = page.getByRole("group", { name: "Owner rotation", exact: true });
  await rotation.waitFor();
  await rotation.getByText("Old owner", { exact: true }).waitFor();
  await rotation.getByText("New owner", { exact: true }).waitFor();
  await rotation.getByText("#0", { exact: true }).waitFor();
  await rotation.getByText("#1", { exact: true }).waitFor();
  await rotation.getByRole("button", { name: "Show old owner actions", exact: true }).click();
  await page.getByRole("button", { name: /Copy old owner/ }).waitFor();
  await page.keyboard.press("Escape");
  await rotation.getByRole("button", { name: "Show new owner actions", exact: true }).waitFor();
  for (const width of [320, 420]) {
    await page.setViewportSize({ width, height: 800 });
    assert.ok(await rotation.evaluate(el => el.scrollWidth <= el.clientWidth), "rotation card fits narrow screens");
    await page.screenshot({ path: `${out}/owner-rotation-${width}.png`, fullPage: true });
  }
  await page.screenshot({ path: `${out}/bunker-action-details.png`, fullPage: true });
  await page.getByRole("button", { name: "Go back", exact: true }).click();
  // Exercise a legacy public row without altering the encrypted operation journal.
  const legacyRotationFixture = async (remove = false) => page.evaluate(async ({ accountId, remove }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("walletchan-history");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("transactions", "readwrite");
      const store = transaction.objectStore("transactions");
      if (remove) store.delete("qa-legacy-owner-rotation");
      else {
        const request = store.getAll();
        request.onsuccess = () => {
          const source = request.result.find((tx: any) => tx.accountId === accountId && tx.safeBunkerMeta);
          if (!source) { transaction.abort(); return; }
          store.put({ ...source, id: "qa-legacy-owner-rotation", createdAt: Date.now(),
            origin: "Bunker recovery", functionName: "Recover Bunker owner", assetChanges: undefined,
            safeBunkerMeta: { ...source.safeBunkerMeta, kind: "recovery", calls: [] } });
        };
      }
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error ?? new Error("Fixture write aborted"));
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  }, { accountId: account.id, remove });
  await legacyRotationFixture();
  await page.reload();
  await page.getByRole("tab", { name: /Activity/ }).click();
  const ownerRotationRow = page.getByRole("button", { name: "Open transaction details for Owner rotation", exact: true });
  await ownerRotationRow.waitFor();
  await page.getByRole("img", { name: "WalletChan", exact: true }).first().waitFor();
  await page.screenshot({ path: `${out}/owner-rotation-activity-identity.png`, fullPage: true });
  await ownerRotationRow.click();
  const ownerRotationIdentity = page.getByRole("region", { name: "Requesting application", exact: true });
  await ownerRotationIdentity.getByText("Owner rotation", { exact: true }).waitFor();
  await ownerRotationIdentity.getByRole("img", { name: "WalletChan", exact: true }).waitFor();
  assert.equal(await page.getByText("Recover Bunker owner", { exact: true }).isVisible(), false);
  assert.equal(await page.getByText("Bunker recovery", { exact: true }).isVisible(), false);
  await page.getByText("Action", { exact: true }).locator("..").getByText("Owner rotation", { exact: true }).waitFor();
  await page.screenshot({ path: `${out}/owner-rotation-details-identity.png`, fullPage: true });
  await page.getByRole("button", { name: "Go back", exact: true }).click();
  await legacyRotationFixture(true);
  const executorRows = await page.evaluate(async (safeAddress) => {
    const response = await chrome.runtime.sendMessage({ type: "getTxHistory" });
    return response.filter((tx: any) => tx.safeExecutionMeta?.safeAddress === safeAddress);
  }, account.address);
  assert.equal(executorRows.length, 1, "gas payer has one Safe executor activity row");
  await page.evaluate(async (accountId) => chrome.runtime.sendMessage({ type: "setActiveAccount", accountId }), executorRows[0].accountId);
  await page.reload();
  await page.getByRole("tab", { name: /Activity/ }).click();
  const executorRow = page.getByRole("button", { name: "Open transaction details for WalletChan", exact: true });
  await executorRow.waitFor({ timeout: 30000 });
  await page.screenshot({ path: `${out}/gas-payer-activity.png`, fullPage: true });
  await executorRow.click();
  await page.getByRole("heading", { name: "Transaction details", exact: true }).waitFor();
  await page.getByLabel("Transaction summary", { exact: true }).getByText("Execute Safe Tx #0", { exact: true }).waitFor();
  await page.screenshot({ path: `${out}/gas-payer-details.png`, fullPage: true });
  await page.getByRole("button", { name: "Go back", exact: true }).click();
  await page.evaluate(async (accountId) => chrome.runtime.sendMessage({ type: "setActiveAccount", accountId }), account.id);
  await page.reload();
  await page.getByRole("button", { name: "Choose account", exact: true }).waitFor();


  // Grouping remains management-only; the grouped intent has one ordinary review.
  const ownerAfter = await readOwner();
  for (const id of ["qa-group-one", "qa-group-two"]) {
    const result = await page.evaluate(async ({ accountId, id }) => chrome.runtime.sendMessage({ type: "createSafeBunkerRequest", id, accountId, chainId: 11155111,
      calls: [{ to: "0x1111111111111111111111111111111111111111", value: "1", data: "0x", operation: 0 }] }), { accountId: account.id, id });
    assert.ok(result.success);
  }
  await page.getByRole("heading", { name: "Transaction request", exact: true }).waitFor();
  await page.getByText("1/2", { exact: true }).waitFor();
  // A newer notification opens the oldest pending request; later requests remain navigable.
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByText("2/2", { exact: true }).waitFor();
  await page.screenshot({ path: `${out}/queued-later-request.png`, fullPage: true });
  assert.ok(await page.getByRole("button", { name: "Confirm", exact: true }).isDisabled());
  await page.getByRole("button", { name: "Review earlier request", exact: true }).click();
  await page.getByText("1/2", { exact: true }).waitFor();
  assert.equal(await page.getByText("Earlier Bunker requests must settle first", { exact: true }).count(), 0);
  await page.screenshot({ path: `${out}/queue-first-request.png`, fullPage: true });
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await page.getByRole("heading", { name: "Transaction request", exact: true }).waitFor();
  await page.getByText("1/2", { exact: true }).waitFor({ state: "hidden" });
  for (let i = 0; i < 60 && !await confirm.isEnabled(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(await confirm.isEnabled(), "rejecting the head exposes a confirmable next request");
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await page.getByRole("button", { name: "Choose account", exact: true }).waitFor();
  for (const id of ["qa-group-three", "qa-group-four"]) {
    const result = await page.evaluate(async ({ accountId, id }) => chrome.runtime.sendMessage({ type: "createSafeBunkerRequest", id, accountId, chainId: 11155111,
      calls: [{ to: "0x1111111111111111111111111111111111111111", value: "1", data: "0x", operation: 0 }] }), { accountId: account.id, id });
    assert.ok(result.success);
  }
  await page.getByRole("heading", { name: "Transaction request", exact: true }).waitFor();
  await page.getByRole("button", { name: "Go back", exact: true }).click();
  await page.getByRole("button", { name: "Choose account", exact: true }).click();
  await page.getByRole("button", { name: "Settings for SafeBunker - Ethereum Sepolia", exact: true }).click();
  await page.getByRole("heading", { name: "Account settings", exact: true }).waitFor();
  await page.getByText("Last verified owner", { exact: true }).waitFor();
  await page.getByText("#1", { exact: true }).waitFor();
  assert.equal(await page.getByText("Select for grouping", { exact: true }).count(), 0);
  assert.equal(await page.getByText("Gas payer", { exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: /^Remove account/ }).isDisabled(), true, "pending requests block removal");
  const displayName = page.getByLabel("Display name", { exact: true });
  await displayName.fill("Renamed QA Bunker");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).waitFor({ state: "hidden" });
  await displayName.fill("SafeBunker - Ethereum Sepolia");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).waitFor({ state: "hidden" });
  await page.getByText("Display name updated", { exact: true }).first().waitFor({ state: "hidden" });
  for (const theme of ["midnight", "bauhaus"]) {
    await page.evaluate(theme => chrome.storage.local.set({ selectedThemeId: theme }), theme);
    for (const width of [320, 420]) {
      await page.setViewportSize({ width, height: 800 });
      await displayName.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${out}/${theme}-${width}-settings.png`, fullPage: true });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      const axe = await new AxeBuilder({ page }).analyze();
      assert.deepEqual(axe.violations.filter(v => ["serious", "critical"].includes(v.impact ?? "")).map(v => ({ id: v.id, nodes: v.nodes.map(n => n.failureSummary) })), []);
    }
  }
  await page.evaluate(() => chrome.storage.local.set({ selectedThemeId: "midnight" }));
  await page.setViewportSize({ width: 420, height: 800 });
  const settingsScroll = page.getByRole("heading", { name: "Account settings", exact: true }).locator("..").locator("..").locator('[data-screen-scroll-owner]');
  await page.getByRole("button", { name: /^Reveal recovery phrase/ }).scrollIntoViewIfNeeded();
  const phraseOffset = await settingsScroll.evaluate(el => el.scrollTop);
  await page.getByRole("button", { name: /^Reveal recovery phrase/ }).click();
  await page.getByRole("heading", { name: "Reveal seed phrase", exact: true }).waitFor();
  await page.locator("input[type=password]").waitFor();
  assert.equal(await page.locator("input[type=password]").count(), 1, "phrase stays behind the existing master-password flow");
  await page.getByRole("button", { name: "Go back", exact: true }).click();
  await page.waitForFunction(offset => {
    const heading = [...document.querySelectorAll('h1')].find(el => el.textContent === "Account settings" && (el as HTMLElement).offsetParent !== null);
    const owner = heading?.closest('header')?.parentElement?.querySelector<HTMLElement>('[data-screen-scroll-owner]');
    return !!owner && Math.abs(owner.scrollTop - offset) <= 1;
  }, phraseOffset);
  await page.getByRole("button", { name: "Go back", exact: true }).click();
  await page.getByRole("heading", { name: /Choose account/i }).waitFor();
  await page.keyboard.press("Escape");
  // Grouping is still a background operation; settings no longer contains a queue.
  const groupedResult = await page.evaluate(async accountId => chrome.runtime.sendMessage({ type: "groupSafeBunkerRequests", accountId, ids: ["qa-group-three", "qa-group-four"] }), account.id);
  assert.ok(groupedResult.success);
  await page.getByRole("button", { name: "1 Pending Request", exact: true }).click();
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await page.getByRole("button", { name: "Choose account", exact: true }).waitFor();
  assert.deepEqual(await readOwner(), ownerAfter, "rejecting grouped calls never signs or rotates");
  holdGasEstimates = true;
  await page.evaluate(() => {
    const runtime = chrome.runtime as any, send = runtime.sendMessage.bind(runtime);
    (window as any).__restoreRejectionQa = () => { runtime.sendMessage = send; };
    runtime.sendMessage = (...args: any[]) => {
      const response = send(...args);
      return args[0]?.type === "rejectSafeBunkerRequest" ? Promise.resolve(response).then(value => new Promise(resolve => setTimeout(() => resolve(value), 300))) : response;
    };
  });
  const rejecting = await page.evaluate(async accountId => chrome.runtime.sendMessage({ type: "createSafeBunkerRequest", id: "qa-reject-preparing", accountId, chainId: 11155111,
    calls: [{ to: "0x1111111111111111111111111111111111111111", value: "1", data: "0x", operation: 0 }] }), account.id);
  assert.ok(rejecting.success);
  await page.getByRole("status", { name: "Estimating gas", exact: true }).waitFor();
  for (let i = 0; i < 30 && !heldGasEstimates.length; i++) await new Promise(resolve => setTimeout(resolve, 100));
  assert.ok(heldGasEstimates.length, "real background gas estimate is stalled");
  assert.equal(await page.getByText("Preparing network fee…", { exact: true }).count(), 0);
  await page.screenshot({ path: `${out}/shared-fee-loader.png`, fullPage: true });
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await page.getByRole("button", { name: /Rejecting…/ }).waitFor();
  assert.equal(await page.getByRole("button", { name: /Signing…/ }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Confirm", exact: true }).locator(".chakra-spinner").count(), 0);
  await page.screenshot({ path: `${out}/reject-during-fee-preparation.png`, fullPage: true });
  await page.getByRole("button", { name: "Choose account", exact: true }).waitFor({ timeout: 3000 });
  holdGasEstimates = false;
  for (const release of heldGasEstimates.splice(0)) release();
  await page.evaluate(() => (window as any).__restoreRejectionQa());
  const rejectedView = await page.evaluate(async id => chrome.runtime.sendMessage({ type: "getSafeBunkerView", id }), account.bunkerId);
  assert.equal(rejectedView.view.operations.find((op: any) => op.id === "qa-reject-preparing").state, "rejected");
  await page.waitForFunction(async () => (await chrome.action.getBadgeText({})) === "");

  await page.getByRole("button", { name: "Choose account", exact: true }).click();
  await page.getByRole("button", { name: "Settings for SafeBunker - Ethereum Sepolia", exact: true }).click();
  await page.getByRole("button", { name: /^Refresh Bunker details/ }).click();
  await page.getByText("Bunker details refreshed", { exact: true }).waitFor();
  await page.getByText("Bunker details refreshed", { exact: true }).waitFor({ state: "hidden" });
  await page.getByRole("button", { name: /^Rotate owner/ }).click();
  await page.getByRole("heading", { name: "Rotate owner", exact: true }).waitFor();
  await page.screenshot({ path: `${out}/settings-recover-owner.png`, fullPage: true });
  await page.getByRole("button", { name: "Review rotation", exact: true }).click();
  await page.getByRole("heading", { name: "Rotate owner", exact: true }).waitFor();
  await page.getByRole("button", { name: "Reject", exact: true }).waitFor();
  const rotationActions = page.getByRole("list", { name: "Owner rotation actions", exact: true });
  await rotationActions.getByText("Remove owner", { exact: true }).waitFor();
  await rotationActions.getByText("Set owner", { exact: true }).waitFor();
  await page.getByRole("group", { name: "Owner rotation", exact: true }).waitFor();
  for (const theme of ["midnight", "bauhaus"]) {
    await page.evaluate(theme => chrome.storage.local.set({ selectedThemeId: theme }), theme);
    for (const width of [320, 420]) {
      await page.setViewportSize({ width, height: 800 });
      await page.screenshot({ path: `${out}/${theme}-${width}-rotation-review.png`, fullPage: true });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      const axe = await new AxeBuilder({ page }).analyze();
      assert.deepEqual(axe.violations.filter(v => ["serious", "critical"].includes(v.impact ?? "")).map(v => v.id), []);
    }
  }
  await page.evaluate(() => chrome.storage.local.set({ selectedThemeId: "midnight" }));
  await page.setViewportSize({ width: 420, height: 800 });
  await page.getByRole("button", { name: "Go back", exact: true }).click();
  await page.getByRole("button", { name: "Review rotation", exact: true }).waitFor();
  const rotationAfterBack = await page.evaluate(async id => chrome.runtime.sendMessage({ type: "getSafeBunkerView", id }), account.bunkerId);
  assert.equal(rotationAfterBack.view.operations.filter((op: any) => op.kind === "recovery").at(-1).state, "rejected");
  await page.waitForFunction(async () => (await chrome.action.getBadgeText({})) === "");
  await page.evaluate(() => {
    const runtime = chrome.runtime as any, send = runtime.sendMessage.bind(runtime);
    let holding = true;
    (window as any).__rotationHeldViews = [];
    (window as any).__restoreRotationViews = () => { holding = false; runtime.sendMessage = send; for (const release of (window as any).__rotationHeldViews) release(); };
    runtime.sendMessage = (...args: any[]) => {
      const response = send(...args);
      if (args[0]?.type !== "getSafeBunkerView" || !document.querySelector('[aria-label="Loading request"]')) return response;
      return Promise.resolve(response).then(value => holding ? new Promise(resolve => (window as any).__rotationHeldViews.push(() => resolve(value))) : value);
    };
  });
  await page.getByRole("button", { name: "Review rotation", exact: true }).click();
  await page.getByRole("status", { name: "Loading request", exact: true }).waitFor();
  await page.waitForFunction(() => (window as any).__rotationHeldViews.length > 0);
  await page.getByRole("button", { name: "Go back", exact: true }).click();
  await page.getByRole("button", { name: "Review rotation", exact: true }).waitFor();
  await page.evaluate(() => (window as any).__restoreRotationViews());
  const loadingRotationAfterBack = await page.evaluate(async id => chrome.runtime.sendMessage({ type: "getSafeBunkerView", id }), account.bunkerId);
  assert.equal(loadingRotationAfterBack.view.operations.filter((op: any) => op.kind === "recovery").at(-1).state, "rejected");
  await page.waitForFunction(async () => (await chrome.action.getBadgeText({})) === "");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: /^Remove account/ }).click();
  await page.getByRole("heading", { name: "Remove account", exact: true }).waitFor();
  const remove = page.getByRole("button", { name: "Remove account", exact: true });
  assert.ok(await remove.isDisabled());
  await page.getByText("I saved my recovery phrase", { exact: true }).click();
  assert.equal(await page.getByLabel("Master password", { exact: true }).count(), 0);
  assert.equal(await page.getByText("Remove this Bunker from WalletChan. Funds and ownership stay onchain.", { exact: true }).count(), 0);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: /^Remove account/ }).click();
  assert.ok(await remove.isDisabled(), "cancel clears removal acknowledgement");
  await page.getByText("I saved my recovery phrase", { exact: true }).click();
  await remove.click();
  await page.getByRole("dialog", { name: "Remove account?", exact: true }).getByRole("button", { name: "Remove account", exact: true }).click();
  // This long fixture can hit Chrome's real per-minute sync quota. A failed repair
  // must leave identity intact; retry only after the browser accepts sync writes.
  const removedHeading = page.getByRole("heading", { name: /Choose account/i });
  for (let attempt = 0; attempt < 75 && !await removedHeading.isVisible(); attempt++) {
    const quota = page.getByText("Browser sync is busy. Wait a minute and try again.", { exact: true });
    if (await quota.isVisible()) {
      const stillPresent = await page.evaluate(async accountId => (await chrome.runtime.sendMessage({ type: "getAccounts" })).some((a: any) => a.id === accountId), account.id);
      assert.ok(stillPresent, "browser quota cannot partially remove the account");
      const writable = await page.evaluate(async () => { try { await chrome.storage.sync.set({ bunkerQaQuotaProbe: true }); return true; } catch { return false; } });
      if (writable) await page.getByRole("dialog", { name: "Remove account?", exact: true }).getByRole("button", { name: "Remove account", exact: true }).click();
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  await removedHeading.waitFor();
  const remainingAccounts = await page.evaluate(async () => chrome.runtime.sendMessage({ type: "getAccounts" }));
  assert.ok(!remainingAccounts.some((a: any) => a.id === account.id), "removal updates account list");
  const archives = await page.evaluate(async () => chrome.storage.local.get(["safeBunkerBindingsV2", "safeBunkerJournalsV2"]));
  assert.ok(archives.safeBunkerBindingsV2 && archives.safeBunkerJournalsV2, "encrypted recovery archives survive removal");
  assert.ok(fallbackReads > 0, "packaged deployment, review and reconciliation used the height fallback");
  assert.deepEqual(errors, []);
  await writeFile(`${out}/summary.json`, JSON.stringify({ bunkerAccountSettings: "pass", publicRecoveryDetails: "pass", recoveryReviewAndBack: "pass", masterRemovalAndArchives: "pass", bunkerActionHistoryAndDetails: "pass", gasPayerActivityAndDetails: "pass", rejectDuringGasPreparation: "pass", submittedRequestLeavesApprovalQueue: "pass", skeletonHeaderAndBack: "pass", confirmationProgress: "pass", directRequestLoading: "pass", sharedPendingBannerAndBadge: "pass", blockNumberFallback: "pass", rpcFailureUi: "pass", deployment: "pass", defaultPayer: "pass", confirmedTransferAndRotation: "pass", homeActivity: "pass", gasChooser: "pass", coldResume: "pass", groupedRejection: "pass", requestQueueAndRejectionAdvance: "pass", matrix, pageErrors: errors }, null, 2));
  console.log(`Bunker execution browser QA passed. Evidence: ${out}`);
} catch (error) {
  const failed = context.pages().find((page) => page.url().includes("/index.html"));
  if (failed) { await failed.screenshot({ path: `${out}/failure.png`, fullPage: true }); await writeFile(`${out}/failure.txt`, await failed.locator("body").innerText()); }
  throw error;
} finally { await context.close(); proxy.closeAllConnections(); await new Promise<void>(resolve => proxy.close(() => resolve())); node.kill("SIGTERM"); await rm(profile, { recursive: true, force: true }); }
