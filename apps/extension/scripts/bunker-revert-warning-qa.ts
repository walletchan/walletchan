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
let revertNextExecution = false;
const target = "0x3333333333333333333333333333333333333333";
const proxy = createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString(), request = JSON.parse(body);
    if (request.method === "eth_sendRawTransaction" && revertNextExecution) {
      revertNextExecution = false;
      await client.request({ method: "anvil_setCode" as any, params: [target, "0x60006000fd"] as any });
    }
    const upstream = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body });
    res.writeHead(upstream.status, { "content-type": "application/json" });
    res.end(await upstream.text());
  } catch { res.writeHead(503); res.end(); }
});
await new Promise<void>((resolve) => proxy.listen(port + 1000, "127.0.0.1", resolve));
const profile = await mkdtemp(path.join(os.tmpdir(), "bunker-execution-"));
const out = "/tmp/bunker-revert-warning-qa"; await mkdir(out, { recursive: true });
const build = path.resolve(process.env.BUNKER_QA_BUILD ?? "build"), errors: string[] = [];
const context = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: { width: 420, height: 800 },
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
    return { id, accountId: preparation.view.id, payerId: payer.id };
  });
  await client.request({ method: "anvil_mine" as any, params: ["0x3"] as any });
  const reconciled = await page.evaluate(id => chrome.runtime.sendMessage({ type: "reconcileSafeBunker", id }), created.id);
  assert.ok(reconciled.success, JSON.stringify(reconciled));
  await page.evaluate(async accountId => chrome.runtime.sendMessage({ type: "setActiveAccount", accountId }), created.accountId);
  await page.reload();
  const ownerIndex = async () => (await page.evaluate(async id => chrome.runtime.sendMessage({ type: "getSafeBunkerView", id }), created.id)).view.ownerIndex;
  page.setDefaultTimeout(15000);
  const start = await ownerIndex();
  const command = async (message: any) => {
    const result = await page.evaluate(message => chrome.runtime.sendMessage(message), message);
    assert.ok(result?.success, JSON.stringify(result)); return result;
  };
  const execute = async (id: string, fail: boolean, recovery = false) => {
    const request = recovery ? (await command({ type: "createSafeBunkerRecovery", accountId: created.accountId })).result.id : id;
    if (!recovery) await command({ type: "createSafeBunkerRequest", id, accountId: created.accountId, chainId: 11155111,
      calls: [{ to: target, value: "0", data: "0x", operation: 0 }] });
    await command({ type: "getSafeBunkerView", id: created.id });
    const reviewed = await command({ type: "reviewSafeBunkerRequest", accountId: created.accountId, requestId: request, payerId: created.payerId, gas: null });
    const operation = reviewed.view.operations.find((op: any) => op.id === request);
    revertNextExecution = fail;
    await command({ type: "confirmSafeBunkerRequest", accountId: created.accountId, requestId: request, digest: operation.reviewDigest, remember: false });
    await client.request({ method: "anvil_mine" as any, params: ["0x3"] as any });
    await command({ type: "reconcileSafeBunker", id: created.id });
    return request;
  };
  const warning = page.getByRole("button", { name: "Last Tx reverted, Rotate owner", exact: true });
  await execute("qa-reverted", true);
  await page.reload();
  await warning.waitFor({ timeout: 30000 });
  assert.equal(await ownerIndex(), start);
  await page.waitForFunction(async () => await chrome.action.getBadgeText({}) === "•");
  assert.deepEqual(await page.evaluate(() => chrome.action.getBadgeBackgroundColor({})), [220, 38, 38, 255]);
  await command({ type: "setActiveAccount", accountId: created.payerId });
  await page.reload(); await warning.waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => chrome.action.getBadgeText({})), "•", "switching accounts cannot clear the notification");
  await command({ type: "setActiveAccount", accountId: created.accountId });
  await page.reload(); await warning.waitFor();
  for (const theme of ["midnight", "bauhaus"]) {
    await page.evaluate(theme => chrome.storage.local.set({ selectedThemeId: theme }), theme);
    await page.reload(); await warning.waitFor();
    await page.setViewportSize({ width: 360, height: 780 });
    await page.screenshot({ path: `${out}/${theme}-warning.png`, fullPage: true });
    const box = await warning.boundingBox(); assert.ok(box && box.height >= 52 && box.width <= 360);
    const style = await warning.evaluate(el => ({ bg: getComputedStyle(el).backgroundColor, fg: getComputedStyle(el).color }));
    assert.notEqual(style.bg, style.fg);
    await warning.focus(); await page.keyboard.press("Enter");
    await page.getByRole("heading", { name: "Rotate owner", exact: true }).waitFor();
    await page.getByRole("button", { name: "Review rotation", exact: true }).waitFor();
    await page.screenshot({ path: `${out}/${theme}-rotation-shortcut.png`, fullPage: true });
    await page.getByRole("button", { name: "Go back", exact: true }).click();
    await page.getByRole("button", { name: /^Rotate owner/ }).click();
    await page.getByRole("heading", { name: "Rotate owner", exact: true }).waitFor();
    await page.getByRole("button", { name: "Go back", exact: true }).click();
    await page.getByRole("button", { name: "Go back", exact: true }).click();
    await warning.waitFor();
    const axe = await new AxeBuilder({ page }).include('[data-bunker-revert-warning]').withTags(["wcag2a", "wcag2aa"]).analyze();
    assert.deepEqual(axe.violations, []);
  }
  await client.request({ method: "anvil_setCode" as any, params: [target, "0x"] as any });
  await execute("qa-new-request", false);
  await page.reload(); await warning.waitFor({ state: "hidden" });
  assert.equal(await ownerIndex(), start + 1);
  await page.waitForFunction(async () => await chrome.action.getBadgeText({}) === "");
  await execute("qa-second-revert", true);
  await page.reload(); await warning.waitFor();
  await client.request({ method: "anvil_setCode" as any, params: [target, "0x"] as any });
  await execute("qa-manual-rotation", false, true);
  await page.reload(); await warning.waitFor({ state: "hidden" });
  assert.equal(await ownerIndex(), start + 2);
  await page.waitForFunction(async () => await chrome.action.getBadgeText({}) === "");
  assert.deepEqual(errors, []);
  await writeFile(`${out}/report.json`, JSON.stringify({ revertedWarning: "pass", rotationShortcut: "pass", freshRequestSameSuccessor: "pass", manualRotation: "pass", badge: "pass", narrowThemesAndKeyboard: "pass", errors }, null, 2));
  console.log("Bunker revert warning browser QA passed.");
} catch (error) {
  const failed = context.pages().find(page => page.url().includes("/index.html"));
  if (failed) { await failed.screenshot({ path: `${out}/failure.png`, fullPage: true }); await writeFile(`${out}/failure.txt`, await failed.locator("body").innerText()); }
  throw error;
} finally { await context.close(); proxy.closeAllConnections(); await new Promise<void>(resolve => proxy.close(() => resolve())); node.kill("SIGTERM"); await rm(profile, { recursive: true, force: true }); }
