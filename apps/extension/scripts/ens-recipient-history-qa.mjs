/** Run against `pnpm dev:preview`. Uses synthetic preview state; never signs or broadcasts. */
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium, expect } from "@playwright/test";

const base = process.env.PREVIEW_URL || "http://localhost:4317";
const output = await mkdtemp(path.join(os.tmpdir(), "walletchan-ens-history-"));
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || "chrome" });

async function openSend(wallet, theme) {
  const page = await browser.newPage({ viewport: { width: 360, height: 760 } });
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(15000);
  page.on("pageerror", (error) => console.error(`${wallet}/${theme}: ${error.message}`));
  {
    // Mount the real Send with each signer prop and the existing preview providers.
    await page.route("**/src/preview/index.tsx*", (route) => route.fulfill({
      contentType: "application/javascript",
      body: `
        import React from '/node_modules/.vite/deps/react.js';
        import ReactDOMClient from '/node_modules/.vite/deps/react-dom_client.js';
        import { ThemeProvider, SELECTED_THEME_STORAGE_KEY } from '/src/theme/index.ts';
        import { NetworksProvider } from '/src/contexts/NetworksContext.tsx';
        import { installPreviewChrome } from '/src/preview/previewChrome.ts';
        import { getPreviewWallet } from '/src/preview/fixtures.ts';
        import { previewPortfolioResponse } from '/src/preview/previewEnvironment.ts';
        import TokenTransfer from '/src/components/Transfer/TokenTransfer.tsx';
        import '/src/index.css';
        import '/src/preview/preview.css';
        installPreviewChrome();
        localStorage.setItem(SELECTED_THEME_STORAGE_KEY, '${theme}');
        await chrome.storage.local.set({ [SELECTED_THEME_STORAGE_KEY]: '${theme}' });
        document.body.classList.add('preview-canvas');
        const account = getPreviewWallet('${wallet === 'ledger' ? 'privateKey' : wallet}');
        window.__ensHistoryQaWallet = '${wallet}';
        ReactDOMClient.createRoot(document.getElementById('preview-root')).render(
          React.createElement(ThemeProvider, null,
            React.createElement(NetworksProvider, null,
              React.createElement(TokenTransfer, { token: previewPortfolioResponse.tokens[1],
                fromAddress: account.address, chainId: 8453, accountType: '${wallet}',
                accounts: [], onBack() {}, onTransferInitiated() {} }))));
      `,
    }));
  }
  await page.route("**/src/hooks/useAddressResolver.ts*", (route) => route.fulfill({
    contentType: "application/javascript",
    body: `export function useAddressResolver(input) {
      const address = input.endsWith('.eth') ? '0x1111111111111111111111111111111111111111'
        : /^0x[0-9a-f]{40}$/i.test(input) ? input : null;
      return {resolvedAddress: address, resolvedName: null, avatar: null,
        isValid: !!address, isResolving: false, isLoadingExtras: false, error: null};
    }`,
  }));
  await page.goto(`${base}/preview/send?wallet=${wallet === "ledger" ? "privateKey" : wallet}&frame=popup&theme=${theme}&canvas=1`);
  await page.locator("#send-recipient").waitFor();
  assert.equal(await page.evaluate(() => window.__ensHistoryQaWallet), wallet);
  return page;
}


try {
  for (const wallet of ["privateKey", "seedPhrase", "bankr", "ledger"]) {
    for (const theme of ["midnight", "bauhaus"]) {
      const page = await openSend(wallet, theme);
      await page.evaluate(() => {
        const original = chrome.runtime.sendMessage.bind(chrome.runtime);
        chrome.runtime.sendMessage = async (message) => {
          if (message.type !== 'getEnsRecipientHistory') return original(message);
          const name = message.ensName;
          if (name === 'slow.eth') await new Promise(r => setTimeout(r, 800));
          if (name === 'unavailable.eth') return { success: false };
          const now = Date.now();
          return {success: true, history: {
            addressUpdatedAt: name === 'old.eth' ? now - 31*86400000 : now - 2*86400000,
          }};
        };
      });
      const input = page.locator('#send-recipient');
      await input.fill('recent.eth');
      await expect(page.getByText('ENS address updated', { exact: true })).toBeVisible();
      await expect(page.getByText('2 days ago', {exact: true})).toBeVisible();
      if (wallet === 'privateKey') await page.screenshot({path: path.join(output, `ens-${theme}-360.png`), fullPage: true});
      await page.setViewportSize({width: 320, height: 568});
      await page.getByText('Confirm the recipient’s address before sending.', {exact: true}).scrollIntoViewIfNeeded();
      await expect(page.getByText('Confirm the recipient’s address before sending.', {exact: true})).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      assert.equal(overflow, false);
      if (wallet === 'privateKey') await page.screenshot({path: path.join(output, `ens-${theme}.png`), fullPage: true});
      await input.fill('old.eth');
      await expect(page.getByText('ENS address updated', {exact: true})).toHaveCount(0);
      await input.fill('unavailable.eth');
      await expect(page.getByText('ENS change history unavailable. Verify the recipient address independently.', {exact: true})).toHaveCount(0);
      await expect(page.getByText('ENS address updated', {exact: true})).toHaveCount(0);
      await input.fill('slow.eth');
      await expect(page.getByText('Checking ENS history…', {exact: true})).toBeVisible();
      await input.fill('0x1111111111111111111111111111111111111111');
      await page.waitForTimeout(1000);
      await expect(page.getByText('ENS address updated', {exact: true})).toHaveCount(0);
      await expect(page.getByText('Checking ENS history…', {exact: true})).toHaveCount(0);
      await page.close();
      console.log(`PASS ${wallet}/${theme}: recent, old, unavailable, stale, raw address, 320px`);
    }
  }
  console.log(`Screenshots: ${output}`);
} finally { await browser.close(); }
