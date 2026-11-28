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
const out = "/tmp/bunker-fee-payment-qa"; await mkdir(out, { recursive: true });
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
  // Renderer fixtures exercise the real shared picker/drawer. Backend signing
  // and EntryPoint execution are independently tested on disposable nodes.
  await page.addInitScript("window.__name = (value) => value;");
  await page.addInitScript(({ id, accountId, payerId }) => {
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    let prepared: any = null;
    const usdc = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", usdt = "0x5555555555555555555555555555555555555555";
    (window as any).__feeQuoteTokens = [];
    (window as any).__nativeReviewFailures = 0;
    const respond = (promise: Promise<any>, args: any[]) => {
      const callback = args.find(a => typeof a === "function");
      if (callback) { void promise.then(callback); return; } return promise;
    };
    const review = async (message: any, tokenId = "native") => {
      const response = await send({ type: "getSafeBunkerView", id });
      const operation = response.view.operations.find((o: any) => o.id === "fee-ui-request");
      const sufficient = tokenId === usdt;
      Object.assign(operation, { state: "reviewed", payerId: message.payerId ?? accountId, payerAddress: response.view.safeAddress,
        reviewDigest: `0x${"ab".repeat(32)}`, reviewExpiresAt: Date.now() + 45000, maxFee: "1000000000000000",
        gas: { gasLimit: "100000", maxFeePerGas: "1000000000", maxPriorityFeePerGas: "100000000" },
        feePayment: message.payerId && message.payerId !== accountId ? undefined : { tokenId, sufficientBalance: sufficient,
          tokenBalance: tokenId === "native" ? "0" : tokenId === usdc ? "1" : "100000000", maximumTokenCost: "10000", approvalAdded: true, approvalAmount: "10000", validUntil: Math.floor(Date.now() / 1000) + 45 } });
      response.view.defaultPayer = localStorage.getItem("qa-eoa-default") ? { id: payerId, address: response.view.safeAddress } : null;
      prepared = response;
      return response;
    };
    chrome.runtime.sendMessage = ((message: any, ...args: any[]) => {
      if (message?.type === "getFeePaymentOptions" && message.requestKind === "bunker") return respond(new Promise(resolve => setTimeout(() => resolve({ success: true, options: [
        { id: "native", symbol: "ETH", decimals: 18, available: true, balance: "0", insufficientBalance: true },
        { id: usdc, symbol: "USDC", decimals: 6, stablecoin: true, available: true, balance: "1" },
        { id: usdt, symbol: "USDT", decimals: 6, stablecoin: true, available: true, balance: "100000000" },
      ] }), 500)), args);
      if (message?.type === "reviewSafeBunkerRequest") {
        if (message.payerId === accountId) {
          (window as any).__nativeReviewFailures++;
          return respond(Promise.resolve({ success: false, error: "Bunker operation unavailable. Unlock, check status and retry. [reviewSafeBunkerRequest]" }), args);
        }
        return respond(review(message), args);
      }
      if (message?.type === "prepareFeePaymentQuote" && message.requestKind === "bunker") return respond((async () => {
        (window as any).__feeQuoteTokens.push(message.feePaymentToken);
        const response = await review({}, message.feePaymentToken), op = response.view.operations.find((o: any) => o.id === "fee-ui-request");
        return { success: true, quoteId: op.reviewDigest, tokenId: message.feePaymentToken, tokenAddress: message.feePaymentToken,
          tokenSymbol: message.feePaymentToken === usdc ? "USDC" : "USDT", tokenDecimals: 6, tokenStablecoin: true,
          maximumTokenCost: "10000", tokenBalance: op.feePayment.tokenBalance, sufficientBalance: op.feePayment.sufficientBalance,
          expiresAt: op.reviewExpiresAt, approvalAdded: true, approvalAmount: "10000", paymaster: usdt, userOperationNonce: "0x0", needsAuthorization: false };
      })(), args);
      if (message?.type === "confirmSafeBunkerRequest" && localStorage.getItem("qa-fail-confirm")) return respond((async () => {
        const operation = prepared.view.operations.find((o: any) => o.id === "fee-ui-request");
        operation.state = "signed"; operation.reviewExpiresAt = Date.now() - 1000;
        operation.feePayment.validUntil = Math.floor(Date.now() / 1000) - 1;
        operation.error = "Could not prepare Bunker gas payment. Check the gas service and retry.";
        return { success: false, error: operation.error };
      })(), args);
      if (message?.type === "reconcileSafeBunker" && localStorage.getItem("qa-fail-confirm")) {
        prepared.view.operations.find((o: any) => o.id === "fee-ui-request").state = "invalidated";
        return respond(Promise.resolve({ success: true }), args);
      }
      if (message?.type === "getSafeBunkerView") return respond((async () => {
        const response = prepared ? structuredClone(prepared) : await send(message);
        if (localStorage.getItem("qa-eoa-default") && response.view) response.view.defaultPayer = { id: payerId, address: response.view.safeAddress };
        return response;
      })(), args);
      return (send as any)(message, ...args);
    }) as typeof chrome.runtime.sendMessage;
  }, created);
  await page.reload();
  await page.evaluate(accountId => chrome.runtime.sendMessage({ type: "createSafeBunkerRequest", id: "fee-ui-request", accountId, chainId: 11155111,
    calls: [{ to: "0x3333333333333333333333333333333333333333", value: "0", data: "0x", operation: 0 }] }), created.accountId);
  await page.getByRole("heading", { name: "Transaction request", exact: true }).waitFor();
  const confirm = page.getByRole("button", { name: "Confirm", exact: true });
  await page.getByText("Insufficient USDC balance for the maximum gas charge", { exact: true }).waitFor();
  assert.ok(await confirm.isDisabled());
  assert.ok(await page.evaluate(() => (window as any).__nativeReviewFailures > 0), "native review failed before balance-based USDC fallback");
  assert.equal(await page.getByText(/Bunker operation unavailable/).count(), 0, "stale native error is cleared after switching");
  assert.equal(await page.getByText(/Estimating gas/).count(), 0, "native spinner stops after failure and token switch");
  assert.deepEqual(await page.evaluate(() => (window as any).__feeQuoteTokens), ["0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"], "insufficient USDC does not automatically quote USDT");
  await page.getByRole("button", { name: "Choose gas payer", exact: true }).click();
  await page.getByText("This Bunker", { exact: true }).waitFor();
  await page.waitForTimeout(250); // Wait for the existing menu entrance animation.
  await page.screenshot({ path: `${out}/payer-menu.png`, fullPage: true });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /USDC/ }).click();
  await page.getByRole("button", { name: /USDT/ }).click();
  await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some(b => b.textContent === "Confirm" && !b.disabled));
  await page.getByRole("heading", { name: "Pay network fee with", exact: true }).waitFor({ state: "hidden" });
  for (const theme of ["midnight", "bauhaus"]) {
    await page.evaluate(theme => chrome.storage.local.set({ selectedThemeId: theme }), theme);
    await page.setViewportSize({ width: 360, height: 800 });
    await page.screenshot({ path: `${out}/${theme}-usdt.png`, fullPage: true });
    assert.ok(await confirm.isEnabled());
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  }
  await page.getByRole("button", { name: /USDT/ }).click();
  await page.getByRole("button", { name: /^ETH/ }).click();
  await page.getByText(/Bunker operation unavailable/).waitFor();
  assert.ok(await page.getByRole("button", { name: /^ETH/ }).isVisible(), "manual ETH choice is preserved despite zero balance");
  assert.equal(await page.getByText(/Estimating gas/).count(), 0, "failed native review stops the spinner");
  await page.getByRole("button", { name: /^ETH/ }).click();
  await page.getByRole("button", { name: /USDT/ }).click();
  await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some(b => b.textContent === "Confirm" && !b.disabled));
  await page.getByRole("button", { name: "Choose gas payer", exact: true }).click();
  await page.getByRole("menuitem").filter({ hasText: /0xf39/i }).click();
  await page.getByText("set default payer for future", { exact: true }).click();
  assert.equal(await page.getByText("Pay network fee with", { exact: true }).count(), 0, "EOA keeps its native gas flow");
  await page.getByRole("button", { name: "Choose gas payer", exact: true }).click();
  await page.getByRole("menuitem").filter({ hasText: "This Bunker" }).click();
  assert.equal(await page.getByRole("checkbox", { name: "set default payer for future", exact: true }).count(), 0, "unsaved EOA choice does not replace implicit self default");
  await page.evaluate(() => localStorage.setItem("qa-eoa-default", "true"));
  await page.reload();
  if (!await page.getByRole("heading", { name: "Transaction request", exact: true }).isVisible()) await page.getByRole("button", { name: "1 Pending Request", exact: true }).click({ timeout: 3000 }).catch(() => {});
  await page.getByRole("heading", { name: "Transaction request", exact: true }).waitFor();
  await page.getByRole("button", { name: "Choose gas payer", exact: true }).click();
  await page.getByRole("menuitem").filter({ hasText: "This Bunker" }).click();
  const selfDefault = page.getByRole("checkbox", { name: "set default payer for future", exact: true });
  await page.getByText("set default payer for future", { exact: true }).click();
  assert.ok(await selfDefault.isChecked(), "Bunker can explicitly replace a saved EOA default");
  await page.getByRole("button", { name: /USDC/ }).click();
  await page.getByRole("button", { name: /USDT/ }).click();
  await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some(b => b.textContent === "Confirm" && !b.disabled));
  await page.evaluate(() => localStorage.setItem("qa-fail-confirm", "true"));
  await confirm.click();
  await page.getByRole("button", { name: "Check status", exact: true }).waitFor();
  await page.getByRole("button", { name: "Back to wallet", exact: true }).waitFor();
  assert.equal(await confirm.count(), 0, "expired signed reviews never offer a disabled Confirm loop");
  await page.getByText(/This request was signed but not submitted/).waitFor();
  await page.getByRole("button", { name: "Check status", exact: true }).click();
  await page.getByText("This request no longer needs approval.", { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  await writeFile(`${out}/report.json`, JSON.stringify({ defaultSelf: "pass", tokenDrawer: "pass", singleTokenQuote: "pass", manualUsdt: "pass", eoaDefaultCheckbox: "pass", narrowThemes: "pass", errors }, null, 2));
  console.log("Bunker fee-payment picker browser QA passed.");
} catch (error) {
  const failed = context.pages().find(p => p.url().includes("/index.html"));
  if (failed) { await failed.screenshot({ path: `${out}/failure.png`, fullPage: true }); await writeFile(`${out}/failure.txt`, await failed.locator("body").innerText()); }
  console.error(errors);
  throw error;
} finally { await context.close(); proxy.closeAllConnections(); await new Promise<void>(resolve => proxy.close(() => resolve())); node.kill("SIGTERM"); await rm(profile, { recursive: true, force: true }); }
