/** Production component QA with synthetic public fixtures; no signing or submission. */
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
const base = process.env.PREVIEW_URL || "http://localhost:4317";
const output = await mkdtemp(
  path.join(os.tmpdir(), "walletchan-signature-history-"),
);
const browser = await chromium.launch({ headless: true, channel: "chrome" });
let cases = 0;
try {
  for (const theme of ["midnight", "bauhaus"]) {
    for (const width of [320, 420]) {
      const page = await browser.newPage({
        viewport: { width, height: 800 },
        timezoneId: "Asia/Dubai",
        acceptDownloads: true,
      });
      const errors = [];
      page.on("pageerror", (error) => {
        errors.push(error.message);
        console.error(error.message);
      });
      await page.route("**/src/preview/index.tsx*", (route) =>
        route.fulfill({
          contentType: "application/javascript",
          body: `
        import React from '/node_modules/.vite/deps/react.js';
        import ReactDOMClient from '/node_modules/.vite/deps/react-dom_client.js';
        import {ThemeProvider} from '/src/theme/index.ts';
        import {installPreviewChrome} from '/src/preview/previewChrome.ts';
        import ClearHistoryScreen from '/src/components/Settings/ClearHistoryScreen.tsx';
        import DataSettings from '/src/components/Settings/DataSettings.tsx';
        import ActivityExportSettings from '/src/components/SignatureHistory/ActivityExportSettings.tsx';
        import {SignatureHistoryList} from '/src/components/SignatureHistory/SignatureHistoryList.tsx';
        import '/src/index.css';
        import '/src/preview/preview.css';
        document.body.classList.add('preview-canvas');
        installPreviewChrome();
        const address = '0x1111111111111111111111111111111111111111';
        window.clears = [];
        let entries = ['message','siwe','typedData','safeApproval','sponsoredTransfer','permission','userOperation'].map((kind,index)=>({
          version:1,id:'fixture-'+index,createdAt:Date.now()-index*60000,accountId:'fixture',ownerAddress:address,
          accountType:'privateKey',origin:'https://example.org',source:index===1?'walletconnect':index===2?'wallet':'injected',method:index<2?'personal_sign':'eth_signTypedData_v4',kind,chainId:1,
          digest:'0x'+'ab'.repeat(32),payload:index<2?'A signed message <script>literal</script>':{domain:{chainId:1},primaryType:'Example',message:{value:'100'}}
        }));
        const state={recordingStartedAt:Date.now()-86400000,prunedCount:0};
        const original=chrome.runtime.sendMessage.bind(chrome.runtime);
        chrome.runtime.sendMessage=(message,callback)=>{
          let response;
          if(message.type==='getActivityHistorySummary') response={success:true,data:{entries,state,transactionCount:message.filter?.ownerAddress ? 1 : 3}};
          else if(message.type==='getSignatureHistory') response={success:true,data:{entries,state}};
          else if(message.type==='getAccounts') response=[{id:'fixture',address,type:'privateKey',displayName:'Main account'},{id:'other',address:'0x'+'2'.repeat(40),type:'privateKey',displayName:'Other account'}];
          else if(message.type==='exportActivity') response={success:true,data:{schemaVersion:2,transactions:[],accounts:{fixture:{address,type:'privateKey',signatures:entries.map(({accountId,accountType,ownerAddress,version,...entry})=>entry)}}}};
          else if(message.type==='getTxHistory') response=[];
          else if(message.type==='clearTxHistoryForAddresses') { window.clears.push(message); response={success:true}; }
          else if(message.type==='clearSignatureHistory') { window.clears.push(message); entries=entries.filter(e=>message.filter && e.ownerAddress!==message.filter.ownerAddress); response={success:true}; }
          else return original(message,callback);
          if(callback)queueMicrotask(()=>callback(response)); return Promise.resolve(response);
        };
        const root=ReactDOMClient.createRoot(document.getElementById('preview-root'));
        window.showSignatureList=()=>root.render(React.createElement(ThemeProvider,{fixedThemeId:'${theme}'},React.createElement('div',{style:{padding:16}},React.createElement(SignatureHistoryList,{address}))));
        window.showData=()=>root.render(React.createElement(ThemeProvider,{fixedThemeId:'${theme}'},React.createElement(DataSettings,{onBack:()=>{},ctx:{onNavigate:id=>id==='activityHistory'?window.showExport():window.showClear(id)}})));
        window.showClear=id=>root.render(React.createElement(ThemeProvider,{fixedThemeId:'${theme}'},React.createElement(ClearHistoryScreen,{kind:id==='clearTxHistory'?'transaction':'signature',onBack:window.showData})));
        window.showExport=()=>root.render(React.createElement(ThemeProvider,{fixedThemeId:'${theme}'},React.createElement('div',{style:{padding:16,height:'100dvh',display:'flex'}},React.createElement(ActivityExportSettings,{onBack:window.showSignatureList}))));
        window.showSignatureList();
      `,
        }),
      );
      await page.goto(`${base}/preview/settings?canvas=1&theme=${theme}`);
      await expect(
        page.getByRole("list", { name: "Signed message history" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /View Signed in/ }),
      ).toBeVisible();
      await page.getByRole("button", { name: /View Signed message/ }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Copy account", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByText("A signed message <script>literal</script>", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Copy signing digest" }),
      ).toBeHidden();
      await expect(page.getByText(/Signing records authorization/)).toHaveCount(
        0,
      );
      await page.waitForTimeout(250);
      await page.screenshot({
        path: path.join(output, `${theme}-${width}-summary.png`),
      });
      await page
        .locator("summary")
        .filter({ hasText: "Technical details" })
        .click();
      await expect(
        page.getByRole("dialog").getByText("Account type", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("dialog").getByText("Source", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Copy signing digest" }),
      ).toBeVisible();
      await expect(
        page.getByText("0x" + "ab".repeat(32), { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("dialog").getByText("Account type", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("dialog").getByText("Source", { exact: true }),
      ).toHaveCount(0);
      await page.screenshot({
        path: path.join(output, `${theme}-${width}-details.png`),
      });
      await page
        .getByRole("button", { name: "Close", exact: true })
        .last()
        .click();
      await page.screenshot({
        path: path.join(output, `${theme}-${width}-history.png`),
      });
      for (const title of ["Signed in", "Signed typed data"]) {
        const trigger = page.getByRole("button", {
          name: new RegExp(`View ${title}`),
        });
        await trigger.click();
        await expect(page.locator("summary")).toHaveAttribute(
          "aria-expanded",
          "false",
        );
        const dialog = page.getByRole("dialog");
        assert.equal(
          await dialog.evaluate((el) => el.scrollWidth > el.clientWidth),
          false,
        );
        await page.locator("summary").focus();
        await page.keyboard.press("Enter");
        await expect(page.locator("summary")).toHaveAttribute(
          "aria-expanded",
          "true",
        );
        await expect(dialog.getByText("Source", { exact: true })).toBeVisible();
        await expect(
          dialog.getByText(
            title === "Signed in" ? "WalletConnect" : "WalletChan",
            { exact: true },
          ),
        ).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
        await expect(trigger).toBeFocused();
      }
      await page.evaluate(() => window.showData());
      const historyRow = page.getByRole("button", { name: /Activity History/i });
      await expect(page.getByRole("button", {name:"Clear Transaction History", exact:true})).toBeVisible();
      await expect(page.getByRole("button", {name:"Clear Signature History", exact:true})).toBeVisible();
      await historyRow.hover();
      const amber = await page.evaluate(() => {
        const sample = document.createElement("i");
        sample.style.color = "var(--chakra-colors-accent-highlight)";
        document.body.append(sample);
        const color = getComputedStyle(sample).color;
        sample.remove();
        return color;
      });
      if (theme === "midnight") await expect(historyRow.locator("[data-settings-row-icon]")).toHaveCSS("color", amber);
      await historyRow.click();
      await expect(page.getByRole("button", { name: "Export JSON" })).toHaveCSS("background-color", amber);
      await page.screenshot({path: path.join(output, `${theme}-${width}-export-default.png`)});
      await expect(
        page.getByText("7 saved signatures"),
      ).toBeVisible();
      await expect(page.getByText("3 transactions", {exact:true})).toBeVisible();
      const txBounds = await page.getByText("3 transactions", {exact:true}).boundingBox();
      const sigBounds = await page.getByText("7 saved signatures", {exact:true}).boundingBox();
      const rowBounds = await page.getByText("3 transactions", {exact:true}).locator("..").boundingBox();
      assert.equal(txBounds.y, sigBounds.y);
      assert.equal(txBounds.x, rowBounds.x);
      assert.ok(Math.abs(sigBounds.x + sigBounds.width - rowBounds.x - rowBounds.width) < 1);
      const choose = page.getByRole("button", { name: "Choose account" });
      const focusWarnings = [];
      page.on("console", message => {
        if (/blocked aria-hidden/i.test(message.text())) focusWarnings.push(message.text());
      });
      await choose.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("heading", { name: "Choose account" })).toBeFocused();
      await expect(page.locator("#preview-root")).toHaveAttribute("inert", "");
      await expect(page.locator("#preview-root")).not.toHaveAttribute("aria-hidden", "true");
      await page.keyboard.press("Escape");
      await expect(choose).toBeFocused();
      assert.deepEqual(focusWarnings, []);
      await choose.click();
      await page.getByRole("button", { name: /Main account/ }).click();
      await choose.click();
      await page.getByRole("button", { name: "All accounts" }).click();
      await choose.click();
      await page.getByRole("button", { name: /Main account/ }).click();
      await expect(page.getByLabel("From date")).toBeHidden();
      await page.getByLabel("Date range").selectOption("custom");
      await expect(page.getByLabel("From date")).toBeVisible();
      await page.getByLabel("Date range").selectOption("all");
      await expect(page.getByText("1 transaction", {exact:true})).toBeVisible();
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("button", { name: "Export JSON" }).click(),
      ]);
      const downloaded = JSON.parse(
        await (
          await import("node:fs/promises")
        ).readFile(await download.path(), "utf8"),
      );
      assert.equal(downloaded.schemaVersion, 2);
      assert.equal(downloaded.accounts.fixture.signatures.length, 7);
      assert.equal(
        "accountType" in downloaded.accounts.fixture.signatures[0],
        false,
      );
      assert.match(
        download.suggestedFilename(),
        /^walletchan-activity-.*\.json$/,
      );
      await expect(page.getByRole("button", { name: /clear/i })).toHaveCount(0);
      await page.screenshot({
        path: path.join(output, `${theme}-${width}-export.png`),
      });
      const overflow = await page.evaluate(() =>
        Array.from(document.querySelectorAll("body *"))
          .filter((el) => el.getBoundingClientRect().right > innerWidth + 1)
          .map((el) => ({
            tag: el.tagName,
            class: el.className,
            right: el.getBoundingClientRect().right,
          }))
          .slice(0, 12),
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        JSON.stringify(overflow),
      );
      await page.evaluate(() => window.showData());
      for (const kind of ["Transaction", "Signature"]) {
        await page.getByRole("button", {name: new RegExp("Clear " + kind + " History")}).click();
        await expect(page.getByRole("button", {name: "Clear history", exact: true})).toBeDisabled();
        await page.getByRole("checkbox", {name:"Select Main account"}).check({force:true});
        const clear = page.getByRole("button", {name:"Clear history for 1 account"});
        await clear.click();
        const dialog = page.getByRole("alertdialog");
        await expect(dialog.getByRole("button", {name:"Cancel"})).toBeFocused();
        await dialog.getByRole("button", {name:"Cancel"}).click();
        await expect(dialog).toBeHidden();
        const before = await page.evaluate(() => window.clears.length);
        assert.equal(before, kind === "Transaction" ? 0 : 1);
        await clear.click();
        await dialog.getByRole("button", {name:"Clear history"}).click();
        await expect(historyRow).toBeVisible();
        const sent = await page.evaluate(() => window.clears.at(-1));
        const address = "0x" + "1".repeat(40);
        assert.deepEqual(sent, kind === "Transaction"
          ? {type:"clearTxHistoryForAddresses", addresses:[address]}
          : {type:"clearSignatureHistory", filter:{ownerAddress:address}});
      }
      await historyRow.click();
      await expect(page.getByText("0 saved signatures")).toBeVisible();
      assert.deepEqual(errors, []);
      cases++;
      await page.close();
    }
  }
  console.log(JSON.stringify({ cases, screenshots: output }));
} finally {
  await browser.close();
}
