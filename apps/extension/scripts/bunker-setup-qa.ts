import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPublicClient, http } from "viem";
import { CHAIN_REGISTRY } from "../src/constants/chainRegistry";
import { completeQaOnboarding } from "./extension-onboarding-qa-support";

const port = 20400 + process.pid % 1000, rpc = `http://127.0.0.1:${port}`;
const node = spawn("anvil", ["--port", String(port), "--host", "127.0.0.1", "--chain-id", "11155111", "--silent"], { stdio: "ignore" });
const client = createPublicClient({ cacheTime: 0, transport: http(rpc, { retryCount: 0 }) });
// Disposable compatibility proxy: never touches the user's configured browser/profile.
const proxyRpc = `http://127.0.0.1:${port + 1000}`;
let failProbe = false;
const proxy = createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString();
    const request = JSON.parse(body);
    if (failProbe && request.method === "eth_chainId") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32000, message: "Disposable unavailable-network fixture" } }));
      return;
    }
    const upstream = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body });
    res.writeHead(upstream.status, { "content-type": "application/json" });
    res.end(await upstream.text());
  } catch { res.writeHead(503); res.end(); }
});
await new Promise<void>((resolve) => proxy.listen(port + 1000, "127.0.0.1", resolve));
const profile = await mkdtemp(path.join(os.tmpdir(), "bunker-execution-"));
const out = "/tmp/bunker-setup-qa"; await mkdir(out, { recursive: true });
const build = path.resolve(process.env.BUNKER_QA_BUILD ?? "build"), errors: string[] = [];
const context = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: { width: 420, height: 800 },
  args: [`--disable-extensions-except=${build}`, `--load-extension=${build}`, "--disable-background-timer-throttling", "--disable-renderer-backgrounding"] });
context.on("page", (page) => page.on("pageerror", (e) => errors.push(e.message)));
try {
  let ready = false;
  for (let i = 0; i < 50; i++) { try { await client.getChainId(); ready = true; break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  assert.ok(ready);
  for (const name of ["factory", "singleton", "multiSend"]) {
    const fixture = JSON.parse(await readFile(new URL(`../tests/safeBunker/fixtures/${name}.json`, import.meta.url), "utf8"));
    await client.request({ method: "anvil_setCode" as any, params: [fixture.address, fixture.runtime] as any });
  }
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host, page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/onboarding.html`);
  await completeQaOnboarding(page, { wallet: "privateKey", password: "bunker-qa-synthetic-master", privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", bankrApiKey: "unused-synthetic" });
  for (const extra of context.pages()) if (extra !== page) await extra.close();
  await page.evaluate(async ({ rpc, CHAINS }) => {
    const { networksInfo = {} } = await chrome.storage.sync.get("networksInfo");
    await chrome.storage.sync.set({ networksInfo: { ...networksInfo, ...Object.fromEntries(CHAINS.map(c => [c.name, { chainId: c.chainId, hidden: c.chainId !== 11155111 }])), "Ethereum Sepolia": { chainId: 11155111, rpcUrl: rpc, hidden: false } } });
    await chrome.runtime.sendMessage({ type: "setSidePanelMode", enabled: false });
  }, { rpc: proxyRpc, CHAINS: CHAIN_REGISTRY.map(({ name, chainId }) => ({ name, chainId })) });
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await page.getByRole("button", { name: "Lock wallet" }).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Choose account", exact: true }).click();
  await page.getByRole("button", { name: "Add account", exact: true }).first().click();
  await page.getByRole("button", { name: /Safe Bunker/ }).click();
  const capture = async (name: string) => {
    // Wait for the existing screen transition to finish before measuring or capturing.
    await page.waitForFunction(() => !document.getAnimations().some(a => a.playState === "running" && a.effect?.getTiming().iterations !== Infinity));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    const axe = await new AxeBuilder({ page }).analyze();
    assert.deepEqual(axe.violations.filter(v => ["serious", "critical"].includes(v.impact ?? "")).map(v => v.id), []);
    await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  };
  await capture("intro");
  await page.getByRole("button", { name: "Proceed", exact: true }).click();
  await page.getByRole("button", { name: "Create or import a seed phrase", exact: true }).click();
  await page.getByRole("button", { name: "Create new seed phrase", exact: true }).click();
  await page.getByRole("heading", { name: "Network", exact: true }).waitFor();
  assert.equal(await page.getByText("Checking for existing Bunkers…", { exact: true }).count(), 0);
  const group = await page.evaluate(async () => (await chrome.storage.local.get("seedGroups")).seedGroups[0]);
  assert.equal(group.accountCount, 0); assert.equal(group.backupPending, true);
  assert.equal(await page.evaluate(async () => (await chrome.storage.local.get("accounts")).accounts.length), 1);
  await page.getByRole("button", { name: "Choose network", exact: true }).click();
  await page.getByRole("button", { name: /Ethereum Sepolia/ }).click();
  await page.getByText("Safe address", { exact: true }).waitFor();
  for (const theme of ["midnight", "bauhaus"]) {
    await page.evaluate(theme => chrome.storage.local.set({ selectedThemeId: theme }), theme);
    for (const width of [320, 420]) { await page.setViewportSize({ width, height: 800 }); await capture(`${theme}-${width}-network`); }
  }
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("heading", { name: "Deploy Bunker", exact: true }).waitFor();
  await page.getByText("SafeBunker - Ethereum Sepolia", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Choose account", exact: true }).click();
  await page.getByRole("menuitem").first().click();
  await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some(b => b.textContent === "Deploy" && !b.disabled));
  for (const theme of ["midnight", "bauhaus"]) {
    await page.evaluate(theme => chrome.storage.local.set({ selectedThemeId: theme }), theme);
    for (const width of [320, 420]) { await page.setViewportSize({ width, height: 800 }); await capture(`${theme}-${width}-deployment`); }
  }
  await page.getByRole("button", { name: "Deploy", exact: true }).click();
  await page.getByRole("tab", { name: "Activity", exact: true }).waitFor({ timeout: 30000 });
  assert.equal(await page.getByRole("tab", { name: "Activity", exact: true }).getAttribute("aria-selected"), "true");
  const account = await page.evaluate(async () => (await chrome.storage.local.get("accounts")).accounts.find((a: any) => a.type === "safeBunker"));
  assert.equal(account.seedGroupId, group.id); assert.equal(account.chainId, 11155111);
  assert.equal(account.derivationVersion, 2);
  await client.request({ method: "anvil_mine" as any, params: ["0x3"] as any });
  const reconciled = await page.evaluate(id => chrome.runtime.sendMessage({ type: "reconcileSafeBunker", id }), account.bunkerId);
  assert.equal(reconciled.success, true, reconciled.error);
  await page.getByRole("button", { name: "Back up your wallet", exact: true }).waitFor();
  await capture("home-shared-backup");
  await page.getByRole("button", { name: "Back up your wallet", exact: true }).click();
  await page.getByLabel("Password", { exact: true }).fill("bunker-qa-synthetic-master");
  await page.getByRole("button", { name: "Reveal phrase", exact: true }).click();
  await page.getByRole("button", { name: "Finish backup", exact: true }).waitFor();
  assert.equal(await page.locator("code").count(), 12);
  await page.getByText("I saved these words somewhere safe", { exact: true }).click();
  await page.getByRole("button", { name: "Finish backup", exact: true }).click();
  assert.equal(await page.evaluate(async () => (await chrome.storage.local.get("seedGroups")).seedGroups[0].backupPending), undefined);
  const derived = await page.evaluate(seedGroupId => chrome.runtime.sendMessage({ type: "deriveSeedAccount", seedGroupId, indices: [0] }), group.id);
  assert.equal(derived.success, true, derived.error);
  const removed = await page.evaluate(accountId => chrome.runtime.sendMessage({ type: "removeSafeBunker", accountId, backedUp: true }), account.id);
  assert.equal(removed.success, true, removed.error);
  await page.reload();
  await page.getByRole("button", { name: "Choose account", exact: true }).click();
  await page.getByRole("button", { name: "Add account", exact: true }).first().click();
  await page.getByRole("button", { name: /Safe Bunker/ }).click();
  await page.getByRole("button", { name: "Proceed", exact: true }).click();
  await page.getByText(group.name, { exact: true }).waitFor();
  await capture("saved-source-list");
  failProbe = true;
  await page.getByRole("button", { name: "Proceed", exact: true }).click();
  await page.getByText("Couldn’t check Ethereum Sepolia", { exact: true }).waitFor();
  await capture("network-check-error");
  failProbe = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page.getByRole("checkbox", { name: /Ethereum Sepolia/ }).waitFor();
  await capture("add-existing");
  await page.getByRole("button", { name: "Choose network", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: /Ethereum Sepolia/ }).isDisabled(), true);
  await page.getByRole("button", { name: "Back", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("checkbox", { name: /Ethereum Sepolia/ }).focus();
  await page.keyboard.press("Space");
  assert.equal(await page.getByRole("checkbox", { name: /Ethereum Sepolia/ }).isChecked(), true);

  const blockBeforeAdd = await client.getBlockNumber();
  await page.getByRole("button", { name: "Add selected accounts", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[role="alert"]') || Array.from(document.querySelectorAll("button")).some(button => button.getAttribute("aria-label") === "Choose account"));
  const activationError = await page.locator('[role="alert"]').allTextContents();
  assert.deepEqual(activationError, []);
  assert.equal(await client.getBlockNumber(), blockBeforeAdd, "Add existing sends no transaction");
  const restored = await page.evaluate(id => chrome.runtime.sendMessage({ type: "getSafeBunkerView", id }), account.bunkerId);
  assert.equal(restored.success, true, restored.error);
  assert.equal(restored.view.recovering, false);
  assert.deepEqual(errors, []);
  await writeFile(`${out}/summary.json`, JSON.stringify({ sharedSourceZeroEoaAndDerive: "pass", normalBackup: "pass", themesAndNarrowScreens: "pass", deploymentAndActivity: "pass", addExistingNoTransaction: "pass", errors }, null, 2));
} catch (error) {
  const failed = context.pages().find((page) => page.url().includes("/index.html"));
  if (failed && await failed.locator("code").count() === 0) { await failed.screenshot({ path: `${out}/failure.png`, fullPage: true }); await writeFile(`${out}/failure.txt`, await failed.locator("body").innerText()); }
  throw error;
} finally { await context.close(); proxy.closeAllConnections(); await new Promise<void>(resolve => proxy.close(() => resolve())); node.kill("SIGTERM"); await rm(profile, { recursive: true, force: true }); }
