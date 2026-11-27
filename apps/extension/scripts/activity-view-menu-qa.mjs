/** Production portfolio UI checks; synthetic data, no wallet signing or submission. */
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium, expect } from "@playwright/test";

const base = process.env.PREVIEW_URL || "http://localhost:4317";
const output = await mkdtemp(path.join(os.tmpdir(), "walletchan-activity-menu-"));
const browser = await chromium.launch({ headless: true, channel: "chrome" });
let cases = 0;
try {
  for (const theme of ["midnight", "bauhaus"]) {
    for (const width of [320, 420]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, timezoneId: "Asia/Dubai" });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`${base}/preview/portfolio?canvas=1&scenario=activity-selected&wallet=privateKey&theme=${theme}`);
      const menu = page.getByRole("button", { name: "Activity options", exact: true });
      await expect(menu).toBeVisible();
      await expect(page.getByRole("button", { name: "Transactions", exact: true })).toHaveCount(0);
      const network = await page.getByRole("button", { name: "All networks", exact: true }).boundingBox();
      const button = await menu.boundingBox();
      assert.ok(network && button && button.x > network.x + network.width);
      assert.ok(Math.abs(network.y + network.height / 2 - button.y - button.height / 2) < 1);
      await menu.focus();
      await page.keyboard.press("Enter");
      const sheet = page.getByRole("dialog", {name:"Activity options"});
      await expect(sheet).toBeVisible();
      await expect(sheet).toHaveAttribute("aria-modal", "true");
      await expect.poll(async () => {
        const bounds = await sheet.boundingBox();
        return Math.abs(bounds.y + bounds.height - 900);
      }).toBeLessThan(2);
      await expect(page.getByRole("dialog").getByRole("button", { name: /^Transactions/ })).toContainText("Selected");
      await page.getByRole("dialog").getByRole("button", { name: /^Signatures/ }).click();
      await expect(page.getByRole("list", { name: "Signed message history" })).toBeVisible();
      await page.screenshot({path:path.join(output,`${theme}-${width}-signatures.png`)});
      for (const tab of ["Assets", "Positions"]) {
        await page.getByRole("tab", {name:tab,exact:true}).click();
        await expect(menu).toBeHidden();
        await page.getByRole("tab", {name:"Activity",exact:true}).click();
        await expect(page.getByRole("list", {name:"Signed message history"})).toHaveCount(0);
        await menu.click();
        await expect(page.getByRole("dialog").getByRole("button", {name:/^Transactions/})).toContainText("Selected");
        await page.getByRole("dialog").getByRole("button", {name:/^Signatures/}).click();
      }
      await page.evaluate(()=>chrome.runtime.sendMessage({type:"clearSignatureHistory",filter:{}}));
      await menu.click();
      await page.getByRole("dialog").getByRole("button", {name:/^Transactions/}).click();
      await menu.click();
      await page.getByRole("dialog").getByRole("button", {name:/^Signatures/}).click();
      await expect(page.getByText("No signed messages yet",{exact:true})).toBeVisible();
      await expect(page.getByText(/Recording begins|Earlier signatures cannot|Successful messages, sign-ins/)).toHaveCount(0);
      await menu.click();
      await expect(page.getByRole("dialog", {name:"Activity options"})).toBeVisible();
      await expect.poll(async () => {
        const bounds = await page.getByRole("dialog", {name:"Activity options"}).boundingBox();
        return Math.abs(bounds.y + bounds.height - 900);
      }).toBeLessThan(2);
      await expect(page.getByRole("dialog").getByRole("button", {name:/^Signatures/})).toBeInViewport();
      await page.screenshot({path:path.join(output,`${theme}-${width}-drawer.png`)});
      await page.keyboard.press("Escape");
      await expect(menu).toBeFocused();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth),false);
      assert.deepEqual(errors,[]);
      cases++; await page.close();
    }
  }
  console.log(JSON.stringify({cases,screenshots:output}));
} finally { await browser.close(); }
