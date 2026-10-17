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
const out = "/tmp/bunker-restore-auth-qa"; await mkdir(out, { recursive: true });
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
    const id = `bunker-draft:${crypto.randomUUID()}`;
    const draft = await chrome.runtime.sendMessage({ type: "createSafeBunkerDraft", id, name: "Picker Focus Bunker" });
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
  const fixture = await page.evaluate(async ({ id, accountId }) => {
    const view = await chrome.runtime.sendMessage({ type: "getSafeBunkerView", id });
    const reveal = await chrome.runtime.sendMessage({ type: "revealSeedPhrase", seedGroupId: id, password: "bunker-qa-synthetic-master" });
    if (!reveal.success) throw new Error("Synthetic phrase could not be revealed");
    const removed = await chrome.runtime.sendMessage({ type: "removeSafeBunker", accountId, backedUp: true });
    if (!removed.success) throw new Error(removed.error);
    return { phrase: reveal.mnemonic, address: view.view.safeAddress, hash: view.view.deploymentHash };
  }, created);
  await page.reload();
  const openRestore = async () => {
    await page.getByRole("button", { name: "Choose account", exact: true }).click();
    await page.getByRole("button", { name: "Add account", exact: true }).first().click();
    await page.getByRole("button", { name: /Safe Bunker/ }).click();
    await page.getByRole("button", { name: "Proceed", exact: true }).click();
    await page.getByRole("button", { name: "Restore existing", exact: true }).click();
    await page.getByLabel("Recovery phrase", { exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector<HTMLTextAreaElement>("#bunker-recovery-phrase")?.disabled);
  };
  await openRestore();
  assert.equal(await page.getByLabel("Master password", { exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Unlock", exact: true }).count(), 0);
  for (const theme of ["midnight", "bauhaus"]) {
    await page.evaluate(theme => chrome.storage.local.set({ selectedThemeId: theme }), theme);
    for (const width of [320, 420]) {
      await page.setViewportSize({ width, height: 800 });
      const axe = await new AxeBuilder({ page }).analyze();
      assert.deepEqual(axe.violations.filter(v => ["serious", "critical"].includes(v.impact ?? "")).map(v => v.id), []);
      await page.screenshot({ path: `${out}/${theme}-${width}-restore.png`, fullPage: true });
    }
  }
  await page.getByLabel("Recovery phrase", { exact: true }).fill(fixture.phrase);
  await page.getByLabel("Safe address", { exact: true }).fill(fixture.address);
  await page.getByLabel("Original deployment transaction", { exact: true }).fill(fixture.hash);
  await page.evaluate(() => {
    const runtime = chrome.runtime as any, send = runtime.sendMessage.bind(runtime);
    (window as any).__restoreCalls = 0;
    runtime.sendMessage = (...args: any[]) => {
      if (args[0]?.type === "getPasswordType") return Promise.resolve({ passwordType: null });
      if (args[0]?.type === "restoreSafeBunker") (window as any).__restoreCalls++;
      return send(...args);
    };
  });
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await page.getByRole("button", { name: "Unlock", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => (window as any).__restoreCalls), 0, "expired session never dispatches the imported phrase");
  assert.equal(await page.getByLabel("Recovery phrase", { exact: true }).count(), 0);
  await page.screenshot({ path: `${out}/expired-session-unlock.png`, fullPage: true });
  // Reload removes the fixture override; the real background master session remains valid.
  await page.reload();
  await openRestore();
  await page.getByLabel("Recovery phrase", { exact: true }).fill(fixture.phrase);
  await page.getByLabel("Safe address", { exact: true }).fill(fixture.address);
  await page.getByLabel("Original deployment transaction", { exact: true }).fill(fixture.hash);
  await page.evaluate(() => {
    const runtime = chrome.runtime as any, send = runtime.sendMessage.bind(runtime);
    (window as any).__restoreMessageKeys = null;
    (window as any).__scanPages = 0;
    let firstView: any;
    runtime.sendMessage = (...args: any[]) => {
      if (args[0]?.type === "restoreSafeBunker") {
        (window as any).__restoreMessageKeys = Object.keys(args[0]).sort();
        return Promise.resolve(send(...args)).then((response: any) => { firstView = response.view; return response; });
      }
      if (args[0]?.type === "continueSafeBunkerRecovery" && ++(window as any).__scanPages <= 2) {
        // Exercise multiple public scan pages before completing the real onchain restore.
        return new Promise(resolve => setTimeout(() => resolve({ success: true, view: firstView }), 350));
      }
      return send(...args);
    };
  });
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await page.getByRole("status", { name: "Restoring Bunker", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Continue recovery", exact: true }).count(), 0);
  assert.equal(await page.getByRole("group", { name: "Bunker setup mode", exact: true }).count(), 0);
  await page.getByRole("button", { name: "Go back", exact: true }).waitFor();
  await page.screenshot({ path: `${out}/automatic-restore-progress.png`, fullPage: true });
  await page.getByRole("button", { name: "Choose account", exact: true }).waitFor({ timeout: 30000 });
  await page.getByText("Restored Bunker", { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => (window as any).__restoreMessageKeys), ["address", "deploymentHash", "id", "seed", "type"]);
  assert.equal((await page.evaluate(() => chrome.runtime.sendMessage({ type: "getActiveAccount" }))).type, "safeBunker");
  assert.equal(await page.evaluate(() => (window as any).__scanPages), 3, "all scan pages ran from one Restore click");
  assert.equal(logRequests, 0, "restore must not request event logs");
  assert.deepEqual(errors, []);
  await writeFile(`${out}/summary.json`, JSON.stringify({ unlockedRestoreWithoutPassword: "pass", actualOnchainRestore: "pass", noEventLogRequests: logRequests, expiredSessionUsesSharedUnlock: "pass", noExpiredRestoreDispatch: "pass", noPasswordTransport: "pass", narrowThemes: "pass", errors }, null, 2));
} catch (error) {
  const failed = context.pages().find((page) => page.url().includes("/index.html"));
  if (failed) { await failed.screenshot({ path: `${out}/failure.png`, fullPage: true }); await writeFile(`${out}/failure.txt`, await failed.locator("body").innerText()); }
  throw error;
} finally { await context.close(); proxy.closeAllConnections(); await new Promise<void>(resolve => proxy.close(() => resolve())); node.kill("SIGTERM"); await rm(profile, { recursive: true, force: true }); }
