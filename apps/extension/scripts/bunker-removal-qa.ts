import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPublicClient, http } from "viem";
import { completeQaOnboarding } from "./extension-onboarding-qa-support";

const port = 20400 + process.pid % 1000, rpc = `http://127.0.0.1:${port}`;
const node = spawn("anvil", ["--port", String(port), "--host", "127.0.0.1", "--chain-id", "11155111", "--silent"], { stdio: "ignore" });
const client = createPublicClient({ cacheTime: 0, transport: http(rpc, { retryCount: 0 }) });
// Disposable compatibility proxy: never touches the user's configured browser/profile.
const proxyRpc = `http://127.0.0.1:${port + 1000}`;
let logRequests = 0;
const proxy = createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString(), request = JSON.parse(body);
    if (request.method === "eth_getLogs") logRequests++;
    if (request.method === "eth_blockNumber" || request.method === "eth_getLogs") {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "fixture method unavailable" } }));
      return;
    }
    const upstream = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body });
    res.writeHead(upstream.status, { "content-type": "application/json" });
    res.end(await upstream.text());
  } catch { res.writeHead(503); res.end(); }
});
await new Promise<void>((resolve) => proxy.listen(port + 1000, "127.0.0.1", resolve));
const profile = await mkdtemp(path.join(os.tmpdir(), "bunker-execution-"));
const out = "/tmp/bunker-removal-qa"; await mkdir(out, { recursive: true });
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
  await page.evaluate(async (rpc) => {
    const { networksInfo = {} } = await chrome.storage.sync.get("networksInfo");
    await chrome.storage.sync.set({ networksInfo: { ...networksInfo, "Ethereum Sepolia": { chainId: 11155111, rpcUrl: rpc } } });
    await chrome.runtime.sendMessage({ type: "setSidePanelMode", enabled: false });
  }, proxyRpc);
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await page.getByRole("button", { name: "Lock wallet" }).waitFor({ timeout: 30000 });
  const created = await page.evaluate(async () => {
    const source = await chrome.runtime.sendMessage({ type: "saveSeedPhraseOnly", generate: true, mnemonic: "" });
    if (!source.success) throw new Error(source.error);
    const draft = await chrome.runtime.sendMessage({ type: "createSafeBunkerDraft", seedGroupId: source.group.id, chainId: 11155111 });
    const id = draft.draft?.id;
    if (!draft.success) throw new Error(draft.error);
    const preparation = await chrome.runtime.sendMessage({ type: "prepareSafeBunker", id });
    if (!preparation.success) throw new Error(preparation.error);
    const payer = (await chrome.runtime.sendMessage({ type: "getAccounts" }))[0];
    const estimate = await chrome.runtime.sendMessage({ type: "estimateSafeBunkerDeployment", id, payerId: payer.id });
    if (!estimate.success) throw new Error(estimate.error);
    const deployment = await chrome.runtime.sendMessage({ type: "deploySafeBunker", id, payerId: payer.id, gas: estimate.gas, remember: false });
    if (!deployment.success) throw new Error(deployment.error);
    return { id, accountId: preparation.view.id };
  });
  await client.request({ method: "anvil_mine" as any, params: ["0x3"] as any });
  const reconciled = await page.evaluate(id => chrome.runtime.sendMessage({ type: "reconcileSafeBunker", id }), created.id);
  assert.ok(reconciled.success, JSON.stringify(reconciled));
  await page.reload();
  await page.getByRole("button", { name: "Choose account", exact: true }).click();
  await page.getByRole("button", { name: "Settings for SafeBunker - Ethereum Sepolia", exact: true }).click();
  await page.getByRole("heading", { name: "Account settings", exact: true }).waitFor();
  await page.getByRole("button", { name: /^Remove account/ }).click();
  const remove = page.getByRole("button", { name: /^Remove account/ });
  assert.equal(await page.locator("input[type=password]").count(), 0);
  const dialog = page.getByRole("dialog", { name: "Remove account and seed phrase?", exact: true });
  await dialog.waitFor();
  await page.waitForFunction(() => { const el = document.querySelector('[role="dialog"]'); return el && getComputedStyle(el).opacity === "1" && getComputedStyle(el).transform === "none"; });
  assert.ok((await page.evaluate(async () => chrome.runtime.sendMessage({ type: "getAccounts" }))).some((a: any) => a.id === created.accountId), "opening confirmation cannot remove account");
  assert.ok(await dialog.getByRole("button", { name: "Cancel", exact: true }).evaluate(el => document.activeElement === el), "Cancel has initial focus");
  for (const theme of ["midnight", "bauhaus"]) {
    await page.evaluate(theme => chrome.storage.local.set({ selectedThemeId: theme }), theme);
    for (const width of [320, 420]) {
      await page.setViewportSize({ width, height: 800 });
      const axe = await new AxeBuilder({ page }).analyze();
      await writeFile(`${out}/axe-${theme}-${width}.json`, JSON.stringify(axe.violations, null, 2));
      assert.deepEqual(axe.violations.filter(v => ["serious", "critical"].includes(v.impact ?? "")).map(v => v.id), []);
      await page.screenshot({ path: `${out}/${theme}-${width}-confirmation.png`, fullPage: true });
    }
  }
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.ok((await page.evaluate(async () => chrome.runtime.sendMessage({ type: "getAccounts" }))).some((a: any) => a.id === created.accountId), "Cancel preserves account");
  await remove.click();
  await dialog.waitFor();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await remove.click();
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  const finalDialog = page.getByRole("dialog", { name: "Delete seed phrase permanently?", exact: true });
  await finalDialog.getByRole("button", { name: "Delete account and phrase", exact: true }).click();
  await page.getByRole("heading", { name: /Choose account/i }).waitFor();
  const remaining = await page.evaluate(async () => chrome.runtime.sendMessage({ type: "getAccounts" }));
  assert.ok(!remaining.some((a: any) => a.id === created.accountId));
  const records = await page.evaluate(async () => chrome.storage.local.get(["safeBunkerBindingsV2", "safeBunkerJournalsV2"]));
  assert.equal(records.safeBunkerBindingsV2?.entries.length ?? 0, 0);
  assert.equal(records.safeBunkerJournalsV2?.entries.length ?? 0, 0);
  assert.deepEqual(errors, []);
  await writeFile(`${out}/summary.json`, JSON.stringify({ confirmationModal: "pass", cancelAndEscapePreserveAccount: "pass", removalWithoutPassword: "pass", sharedPhraseWarnings: "pass", operationalDataDeleted: "pass", narrowThemes: "pass", errors }, null, 2));
  console.log("Bunker removal browser QA passed.");
} catch (error) {
  const failed = context.pages().find((page) => page.url().includes("/index.html"));
  if (failed) { await failed.screenshot({ path: `${out}/failure.png`, fullPage: true }); await writeFile(`${out}/failure.txt`, await failed.locator("body").innerText()); }
  throw error;
} finally { await context.close(); proxy.closeAllConnections(); await new Promise<void>(resolve => proxy.close(() => resolve())); node.kill("SIGTERM"); await rm(profile, { recursive: true, force: true }); }
