import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";
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
const proxy = createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString();
    const upstream = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body });
    res.writeHead(upstream.status, { "content-type": "application/json" });
    res.end(await upstream.text());
  } catch { res.writeHead(503); res.end(); }
});
await new Promise<void>((resolve) => proxy.listen(port + 1000, "127.0.0.1", resolve));
const profile = await mkdtemp(path.join(os.tmpdir(), "bunker-execution-"));
const out = "/tmp/bunker-preview-qa"; await mkdir(out, { recursive: true });
const build = path.resolve(process.env.BUNKER_QA_BUILD ?? "build"), errors: string[] = [];
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
  const extensionId = await extensionManager.locator("extensions-item").first().getAttribute("id");
  assert.ok(extensionId, "unpacked extension is registered");
  const page = await context.newPage();
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
    return { id, accountId: preparation.view.id, payerId: payer.id };
  });
  await client.request({ method: "anvil_mine" as any, params: ["0x3"] as any });
  const reconciled = await page.evaluate(id => chrome.runtime.sendMessage({ type: "reconcileSafeBunker", id }), created.id);
  assert.ok(reconciled.success, JSON.stringify(reconciled));
  await page.evaluate(async accountId => chrome.runtime.sendMessage({ type: "setActiveAccount", accountId }), created.accountId);
  await page.reload();
  page.setDefaultTimeout(15000);
  // Only the optional renderer asset preview is unavailable. Real fee review,
  // exact signed preflight and onchain execution continue through the worker.
  await page.addInitScript(() => {
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = ((message: any, ...args: any[]) => {
      if (message?.type === "simulateSafeAssetChanges") {
        const unavailable = { txSuccess: true, nativeChange: null, tokenChanges: [], approvalChanges: [], residualApprovals: [], approvalDetectionIncomplete: true, simulationFailed: true, simulationError: "Synthetic preview unavailable", metadataComplete: true };
        const callback = args.find(arg => typeof arg === "function");
        if (callback) { queueMicrotask(() => callback(unavailable)); return; }
        return Promise.resolve(unavailable);
      }
      return (send as any)(message, ...args);
    }) as typeof chrome.runtime.sendMessage;
  });
  await page.reload();
  const queued = await page.evaluate(accountId => chrome.runtime.sendMessage({ type: "createSafeBunkerRequest", id: "preview-unavailable", accountId, chainId: 11155111,
    calls: [{ to: "0x3333333333333333333333333333333333333333", value: "0", data: "0x", operation: 0 }] }), created.accountId);
  assert.ok(queued.success);
  await page.getByRole("heading", { name: "Transaction request", exact: true }).waitFor();
  await page.getByRole("button", { name: "Choose gas payer", exact: true }).click();
  await page.getByRole("menuitem").filter({ hasText: /0xf39/i }).click();
  const warning = page.getByText("Asset change simulation unavailable. Onchain transfers may still occur.", { exact: true });
  const confirm = page.getByRole("button", { name: "Confirm", exact: true });
  await warning.waitFor();
  await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some(button => button.textContent === "Confirm" && !button.disabled));
  assert.equal(await page.getByRole("checkbox", { name: /asset preview/i }).count(), 0);
  for (const theme of ["midnight", "bauhaus"]) {
    await page.evaluate(theme => chrome.storage.local.set({ selectedThemeId: theme }), theme);
    await page.reload();
    await warning.waitFor();
    await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some(button => button.textContent === "Confirm" && !button.disabled));
    await page.setViewportSize({ width: 360, height: 800 });
    await page.screenshot({ path: `${out}/${theme}-unavailable.png`, fullPage: true });
    assert.ok(await confirm.isEnabled());
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  }
  await confirm.click();
  await page.getByRole("button", { name: "Choose account", exact: true }).waitFor({ timeout: 30000 });
  await client.request({ method: "anvil_mine" as any, params: ["0x3"] as any });
  const response = await page.evaluate(id => chrome.runtime.sendMessage({ type: "reconcileSafeBunker", id }), created.id);
  assert.ok(response.success);
  const result = await page.evaluate(id => chrome.runtime.sendMessage({ type: "getSafeBunkerView", id }), created.id);
  assert.equal(result.view.ownerIndex, 1);
  assert.deepEqual(errors, []);
  await writeFile(`${out}/report.json`, JSON.stringify({ noAcknowledgment: "pass", sharedWarning: "pass", confirmEnabled: "pass", executionAndRotation: "pass", narrowThemes: "pass", errors }, null, 2));
  console.log("Bunker unavailable-preview browser QA passed.");
} catch (error) {
  const failed = context.pages().find(page => page.url().includes("/index.html"));
  if (failed) { await failed.screenshot({ path: `${out}/failure.png`, fullPage: true }); await writeFile(`${out}/failure.txt`, await failed.locator("body").innerText()); }
  throw error;
} finally { await context.close(); proxy.closeAllConnections(); await new Promise<void>(resolve => proxy.close(() => resolve())); node.kill("SIGTERM"); await rm(profile, { recursive: true, force: true }); }
