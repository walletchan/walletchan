import assert from "node:assert/strict";
import { chromium, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { completeQaOnboarding } from "./extension-onboarding-qa-support";

const build = path.resolve("build");
const out = "/tmp/bunker-foundation-qa";
const profile = await mkdtemp(path.join(os.tmpdir(), "bunker-foundation-"));
const password = "bunker-foundation-qa-master";
await mkdir(out, { recursive: true });
const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium", headless: true, viewport: { width: 420, height: 800 },
  args: [`--disable-extensions-except=${build}`, `--load-extension=${build}`,
    "--disable-background-timer-throttling", "--disable-renderer-backgrounding"],
});
const errors: string[] = [];
context.on("page", (page) => page.on("pageerror", (e) => errors.push(e.message)));
try {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/onboarding.html`);
  await completeQaOnboarding(page, { wallet: "privateKey", password,
    privateKey: `0x${"22".repeat(32)}`, bankrApiKey: "unused-synthetic" });
  await page.evaluate(() => chrome.runtime.sendMessage({ type: "setSidePanelMode", enabled: false }));
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await page.getByRole("button", { name: "Lock wallet" }).waitFor({ timeout: 30000 });
  const openDrafts = async (p: Page) => {
    await p.getByRole("button", { name: "Choose account", exact: true }).click();
    await p.getByRole("button", { name: "Add account", exact: true }).first().click();
    await p.getByRole("button", { name: /Safe Bunker/ }).click();
    await p.getByRole("button", { name: "Create draft", exact: true }).waitFor();
    await p.getByText("Checking your drafts…", { exact: true }).waitFor({ state: "hidden" });
  };
  await openDrafts(page);
  await page.screenshot({ path: `${out}/empty-draft.png`, fullPage: true });
  await page.getByLabel("Name", { exact: true }).fill("Foundation QA Bunker");
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await page.getByText("Foundation QA Bunker", { exact: true }).waitFor();
  const snapshot = await page.evaluate(async () => {
    const stored = await chrome.storage.local.get(["accounts", "safeBunkerDraftVault", "pkVault"]);
    return { accountTypes: stored.accounts.map((a: { type: string }) => a.type),
      draftCount: stored.safeBunkerDraftVault.entries.length,
      pkCount: stored.pkVault.entries.length,
      id: stored.safeBunkerDraftVault.entries[0].header.id };
  });
  assert.deepEqual(snapshot.accountTypes, ["privateKey"]);
  assert.equal(snapshot.draftCount, 1); assert.equal(snapshot.pkCount, 1);
  const matrix: unknown[] = [];
  for (const theme of ["midnight", "bauhaus"]) {
    await page.evaluate(async (theme) => {
      await chrome.storage.local.set({ selectedThemeId: theme });
    }, theme);
    for (const width of [320, 420, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await page.screenshot({ path: `${out}/${theme}-${width}-draft.png`, fullPage: true });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "horizontal overflow");
      const axe = await new AxeBuilder({ page }).analyze();
      const serious = axe.violations.filter((v) => ["serious", "critical"].includes(v.impact ?? ""));
      assert.deepEqual(serious.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) })), []);
      matrix.push({ theme, width, axe: "pass" });
    }
  }
  await page.setViewportSize({ width: 420, height: 800 });
  await page.getByRole("button", { name: "Reveal recovery phrase" }).click();
  await page.getByLabel("Password", { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: "Reveal phrase", exact: true }).click();
  await page.getByText("Invalid password", { exact: true }).waitFor();
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Reveal phrase", exact: true }).click();
  await page.getByRole("button", { name: "Show", exact: true }).waitFor();
  assert.equal(await page.locator("code").count(), 12);
  await page.getByRole("button", { name: "Show", exact: true }).click();
  // Only verify rendering count; never log or screenshot recovery words.
  assert.equal(await page.locator("code").filter({ hasText: "••••" }).count(), 0);
  await page.getByRole("button", { name: "Hide", exact: true }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Lock wallet" }).waitFor({ timeout: 30000 });
  await openDrafts(page);
  await page.getByText("Foundation QA Bunker", { exact: true }).waitFor();
  const duplicate = await page.evaluate(async (id) => {
    const a = await chrome.runtime.sendMessage({ type: "createSafeBunkerDraft", id, name: "Foundation QA Bunker" });
    const b = await chrome.runtime.sendMessage({ type: "createSafeBunkerDraft", id, name: "Foundation QA Bunker" });
    const stored = await chrome.storage.local.get("safeBunkerDraftVault");
    return { success: a.success && b.success, count: stored.safeBunkerDraftVault.entries.length };
  }, snapshot.id);
  assert.deepEqual(duplicate, { success: true, count: 1 });
  const agent = await page.evaluate(async (password) => chrome.runtime.sendMessage({
    type: "setAgentPassword", agentPassword: "bunker-foundation-qa-agent", masterPassword: password,
  }), password);
  assert.equal(agent.success, true);
  await page.evaluate(() => chrome.runtime.sendMessage({ type: "lockWallet" }));
  await page.getByLabel("Enter password to unlock", { exact: true }).fill("bunker-foundation-qa-agent");
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await page.getByRole("button", { name: "Lock wallet" }).waitFor();
  const blocked = await page.evaluate(async (id) => ({
    list: await chrome.runtime.sendMessage({ type: "listSafeBunkerDrafts" }),
    reveal: await chrome.runtime.sendMessage({ type: "revealSeedPhrase", seedGroupId: id, password: "bunker-foundation-qa-master" }),
  }), snapshot.id);
  assert.equal(blocked.list.success, false); assert.equal(blocked.reveal.success, false);
  assert.equal(blocked.reveal.mnemonic, undefined);
  assert.deepEqual(errors, []);
  const result = { matrix, encryptedDraft: true, noActiveAccount: true, seedReveal: true,
    wrongPassword: "rejected", persistentReload: true, idempotentRetry: true, agent: "blocked", pageErrors: errors };
  await writeFile(`${out}/results.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
