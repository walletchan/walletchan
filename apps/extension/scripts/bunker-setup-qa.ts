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
const proxy = createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString(), request = JSON.parse(body);
    if (request.method === "eth_blockNumber") {
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
  const capture = async (name: string) => {
    // Wait for the existing screen transition to finish before measuring or capturing.
    await page.waitForFunction(() => !document.getAnimations().some(a => a.playState === "running" && a.effect?.getTiming().iterations !== Infinity));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    const axe = await new AxeBuilder({ page }).analyze();
    assert.deepEqual(axe.violations.filter(v => ["serious", "critical"].includes(v.impact ?? "")).map(v => v.id), []);
    await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  };
  for (const theme of ["midnight", "bauhaus"]) {
    await page.evaluate(theme => chrome.storage.local.set({ selectedThemeId: theme }), theme);
    for (const width of [320, 420]) {
      await page.setViewportSize({ width, height: 800 });
      await capture(`${theme}-${width}-intro`);
      await page.getByRole("button", { name: "Proceed", exact: true }).click();
      await page.getByLabel(/^Name/).waitFor();
      await capture(`${theme}-${width}-create`);
      await page.getByRole("button", { name: "Restore existing", exact: true }).click();
      await page.getByLabel("Recovery phrase", { exact: true }).waitFor();
      await capture(`${theme}-${width}-restore`);
      await page.getByRole("button", { name: "Create new", exact: true }).click();
      await page.getByLabel(/^Name/).waitFor();
      await page.getByRole("button", { name: "Go back", exact: true }).click();
      await page.getByRole("button", { name: "Proceed", exact: true }).waitFor();
    }
  }
  await page.evaluate(() => chrome.storage.local.set({ selectedThemeId: "midnight" }));
  await page.getByRole("button", { name: "Proceed", exact: true }).click();
  await page.getByLabel(/^Name/).fill("Setup QA Bunker");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("heading", { name: "Deploy Bunker", exact: true }).waitFor();
  await page.getByText("Setup QA Bunker", { exact: true }).waitFor();
  await page.getByText("Pay for deployment using", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Choose account", exact: true }).waitFor();
  assert.equal(await page.getByRole("checkbox", { name: /default/ }).count(), 0);
  assert.ok(!(await page.locator("body").innerText()).toLowerCase().includes("draft"));
  for (const theme of ["midnight", "bauhaus"]) {
    await page.evaluate(theme => chrome.storage.local.set({ selectedThemeId: theme }), theme);
    for (const width of [320, 420]) { await page.setViewportSize({ width, height: 800 }); await capture(`${theme}-${width}-deploy`); }
  }
  await page.evaluate(() => chrome.storage.local.set({ selectedThemeId: "midnight" }));
  const prepared = await page.evaluate(async () => (await chrome.storage.local.get("safeBunkerDraftVault")).safeBunkerDraftVault.entries[0].header.id);
  await page.getByRole("button", { name: "Go back", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).first().click();
  await page.getByRole("heading", { name: "Deploy Bunker", exact: true }).waitFor();
  assert.equal(await page.evaluate(async () => (await chrome.storage.local.get("safeBunkerDraftVault")).safeBunkerDraftVault.entries.length), 1, "Back and Continue reuse the same seed");
  await page.getByRole("button", { name: /^Reveal recovery phrase/ }).click();
  await page.getByLabel("Password", { exact: true }).fill("bunker-qa-synthetic-master");
  await page.getByRole("button", { name: "Reveal phrase", exact: true }).click();
  await page.getByRole("button", { name: "Finish backup", exact: true }).waitFor();
  assert.equal(await page.locator("code").count(), 12, "Bunker backup displays exactly 12 words");
  await page.getByRole("button", { name: "Go back", exact: true }).click();
  const unconfirmed = await page.evaluate(id => chrome.runtime.sendMessage({ type: "getSafeBunkerView", id }), prepared);
  assert.equal(unconfirmed.view.backupPending, true, "revealing alone never confirms backup");
  await page.getByRole("button", { name: "Choose account", exact: true }).click();
  await page.getByRole("menuitem").first().click();
  await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some(b => b.textContent === "Deploy" && !b.disabled));
  await capture("deployment-review");
  await page.getByRole("button", { name: "Deploy", exact: true }).click();
  await page.getByRole("button", { name: "Back up your wallet", exact: true }).waitFor({ timeout: 30000 });
  assert.ok(await page.getByRole("tab", { name: "Activity", exact: true }).getAttribute("aria-selected") === "true");
  await client.request({ method: "anvil_mine" as any, params: ["0x3"] as any });
  // The theme/navigation matrix can exhaust Chrome's per-minute sync write quota.
  // Give the disposable profile a new write window before testing activation.
  await page.evaluate(async () => {
    for (let attempt = 0; attempt < 75; attempt++) {
      try { await chrome.storage.sync.set({ bunkerSetupQaProbe: Date.now() }); return; }
      catch (error) {
        if (!String(error).includes("MAX_WRITE_OPERATIONS_PER")) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    throw new Error("Chrome sync quota did not recover");
  });
  await page.evaluate(async () => {
    const { accounts } = await chrome.storage.local.get("accounts");
    const account = accounts.find((a: any) => a.type === "safeBunker");
    const response = await chrome.runtime.sendMessage({ type: "reconcileSafeBunker", id: account.seedVaultId });
    if (!response.success) throw new Error(response.error);
  });
  await page.getByRole("button", { name: "Back up your wallet", exact: true }).waitFor();
  const active = await page.evaluate(async () => (await chrome.runtime.sendMessage({ type: "getAccounts" })).find((a: any) => a.type === "safeBunker"));
  assert.equal(active.backupPending, true);
  const activatedView = await page.evaluate(id => chrome.runtime.sendMessage({ type: "getSafeBunkerView", id }), prepared);
  assert.equal(activatedView.view.defaultPayer, null, "deployment never saves a transaction default");
  assert.equal((await page.evaluate(() => chrome.runtime.sendMessage({ type: "getActiveAccount" }))).id, active.id);
  await page.reload();
  await page.getByRole("button", { name: "Back up your wallet", exact: true }).waitFor();
  await page.getByText("Setup QA Bunker", { exact: true }).waitFor();
  await capture("home-backup-reminder");
  await page.getByRole("button", { name: "Back up your wallet", exact: true }).click();
  await page.getByRole("heading", { name: "Back up your wallet", exact: true }).waitFor();
  await page.getByLabel("Password", { exact: true }).fill("bunker-qa-synthetic-master");
  await page.getByRole("button", { name: "Reveal phrase", exact: true }).click();
  await page.getByText("I saved these words somewhere safe", { exact: true }).click();
  await page.getByRole("button", { name: "Finish backup", exact: true }).click();
  await page.getByRole("button", { name: "Choose account", exact: true }).waitFor();
  await page.getByRole("button", { name: "Back up your wallet", exact: true }).waitFor({ state: "hidden" });
  await page.reload();
  await page.getByRole("button", { name: "Choose account", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Back up your wallet", exact: true }).count(), 0);
  assert.equal((await page.evaluate(id => chrome.runtime.sendMessage({ type: "getSafeBunkerView", id }), prepared)).view.backupPending, false);
  await writeFile(`${out}/summary.json`, JSON.stringify({ introCreateRestoreDeployment: "pass", themesAndNarrowScreens: "pass", addressIdentityAndInlinePayer: "pass", optionalBackupAndHomeReminder: "pass", backupSurvivesReload: "pass", noDeploymentPayerDefault: "pass", errors }, null, 2));
} catch (error) {
  const failed = context.pages().find((page) => page.url().includes("/index.html"));
  if (failed) { await failed.screenshot({ path: `${out}/failure.png`, fullPage: true }); await writeFile(`${out}/failure.txt`, await failed.locator("body").innerText()); }
  throw error;
} finally { await context.close(); proxy.closeAllConnections(); await new Promise<void>(resolve => proxy.close(() => resolve())); node.kill("SIGTERM"); await rm(profile, { recursive: true, force: true }); }
