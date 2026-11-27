/** Synthetic production-renderer QA; never signs, submits, or uses wallet secrets. */
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';

const base = process.env.PREVIEW_URL || 'http://localhost:4317';
const output = await mkdtemp(path.join(os.tmpdir(), 'walletchan-cow-order-'));
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
const results = [];
async function open({ wallet = 'privateKey', theme = 'midnight', width = 360, scenario = 'cow-sell', disabled = false, metadataMissing = false, remote = false } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 760 }, timezoneId: 'Asia/Dubai' });
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/src/preview/index.tsx*', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOMClient from '/node_modules/.vite/deps/react-dom_client.js';
    import { ThemeProvider, SELECTED_THEME_STORAGE_KEY } from '/src/theme/index.ts';
    import { NetworksProvider } from '/src/contexts/NetworksContext.tsx';
    import { installPreviewChrome } from '/src/preview/previewChrome.ts';
    import { createPreviewSignatureRequest } from '/src/preview/fixtures.ts';
    import { applyCowSignatureScenario, createCowOrderFixture } from '/src/preview/cowOrderFixtures.ts';
    import SignatureRequestConfirmation from '/src/components/SignatureConfirmation/SignatureRequestConfirmation.tsx';
    import '/src/index.css';
    import '/src/preview/preview.css';
    installPreviewChrome();
    localStorage.setItem(SELECTED_THEME_STORAGE_KEY, '${theme}');
    await chrome.storage.local.set({ [SELECTED_THEME_STORAGE_KEY]: '${theme}' });
    document.body.classList.add('preview-canvas');
    const fixture = createCowOrderFixture();
    const formatKey = 'Order(' + fixture.types.Order.map(f => f.type + ' ' + f.name).join(',') + ')';
    const remoteAddress = '${scenario === "cow-spoof" ? "0x1111111111111111111111111111111111111111" : "0x9008d19f58aabd9ed0d60971565aa8510560ab41"}';
    const remoteDescriptor = { context: { eip712: {
      domain: {...fixture.domain, verifyingContract:remoteAddress},
      deployments:[{chainId:8453,address:remoteAddress}]
    } }, display: {formats: {[formatKey]: {intent: 'Remote CoW spoof', fields:[{path:'#.sellAmount',label:'Spoofed amount'}]}}} };
    const original = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (message, callback) => {
      let result;
      if (message.type === 'GET_CLEAR_SIGNING_DESCRIPTOR') result = { enabled: ${!disabled}, descriptor: ${remote ? 'remoteDescriptor' : 'null'} };
      else if (${metadataMissing} && message.type === 'resolveTokenMetadata') result = { success: false, data: null };
      else return original(message, callback);
      if (callback) queueMicrotask(() => callback(result));
      return Promise.resolve(result);
    };
    const request = applyCowSignatureScenario(createPreviewSignatureRequest('${['ledger','trezor','safe','impersonator'].includes(wallet) ? 'privateKey' : wallet}'), '${scenario}');
    request.accountType = '${wallet}';
    const noop = () => {};
    ReactDOMClient.createRoot(document.getElementById('preview-root')).render(
      React.createElement(ThemeProvider, null, React.createElement(NetworksProvider, null,
        React.createElement(SignatureRequestConfirmation, {
          sigRequest: request, currentIndex: 0, totalCount: 1, isInSidePanel: false,
          accountType: '${wallet}', onBack: noop, onCancelled: noop,
          onRejectAll: noop, onNavigate: noop
        }))));
  ` }));
  await page.goto(`${base}/preview/signature?canvas=1&theme=${theme}`);
  return { page, errors };
}
async function noOverflow(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
}
try {
  for (const wallet of ['privateKey', 'seedPhrase', 'bankr', 'ledger', 'trezor', 'impersonator', 'safe']) {
    for (const theme of ['midnight', 'bauhaus']) {
      const { page, errors } = await open({ wallet, theme });
      await expect(page.getByText('CoW Protocol order', { exact: true })).toBeVisible();
      await expect(page.getByText('Minimum received', { exact: true })).toBeVisible();
      await expect(page.getByText('0.00040576', { exact: true })).toBeVisible();
      await expect(page.getByText('USDC', { exact: true })).toBeVisible();
      await expect(page.getByText(/GMT\+4/)).toBeVisible();
      const sign = page.getByRole('button', { name: 'Sign', exact: true });
      if (wallet === 'safe') await expect(sign).toBeDisabled();
      else if (wallet === 'impersonator') await expect(sign).toHaveCount(0);
      else await expect(sign).toBeEnabled();
      await page.getByText('0.00040576', {exact:true}).hover();
      await expect(page.getByRole('tooltip').filter({hasText:'0.000405761030829127 ETH'})).toBeVisible();
      await page.mouse.move(0, 0);
      const token = page.getByRole('button', {name:'Show USDC token contract'});
      await token.focus();
      await expect(page.getByRole('tooltip').filter({hasText:'0x833589'})).toBeVisible();
      await page.mouse.move(0, 0); await token.blur();
      if (wallet === 'privateKey') {
        await page.getByText('Advanced details', {exact:true}).click();
        await expect(page.getByRole('tab', {name:'Raw typed data',exact:true})).toBeVisible();
        await page.getByRole('tab', {name:'Raw typed data',exact:true}).click();
        await expect(page.getByText(/0x872c06fd52c6cf89e4cf691a0a290ba76e0f476d556730b67651319996948f24/)).toBeVisible();
        await page.getByText('Advanced details', {exact:true}).click();
      }
      await noOverflow(page);
      await page.setViewportSize({width:320,height:568});
      await noOverflow(page);
      await page.getByText('Partially fillable', {exact:true}).scrollIntoViewIfNeeded();
      await expect(page.getByText('Partially fillable', {exact:true})).toBeVisible();
      await expect(page.getByRole('button', { name: wallet === 'impersonator' ? 'Reject request' : 'Sign', exact: true })).toBeVisible();
      if (wallet === 'privateKey') {
        await page.screenshot({path: path.join(output, `${theme}-320.png`),fullPage:true});
        await page.setViewportSize({width:420,height:760});
        await page.screenshot({path: path.join(output, `${theme}-420.png`),fullPage:true});
      }
      assert.deepEqual(errors, []);
      results.push(`${wallet}/${theme}: amounts, date, full precision, token focus, signing state, 320px`);
      await page.close();
    }
  }
  for (const scenario of ['cow-buy', 'cow-partial', 'cow-zero-receiver', 'cow-spoof']) {
    const {page, errors} = await open({scenario, remote:scenario === 'cow-spoof' || scenario === 'cow-partial'});
    if (scenario === 'cow-spoof') {
      await expect(page.getByText('Primary type', {exact:true})).toBeVisible();
      await expect(page.getByText('CoW Protocol order', {exact:true})).toHaveCount(0);
      await expect(page.getByText('Remote CoW spoof', {exact:true})).toHaveCount(0);
    } else {
      await expect(page.getByText('CoW Protocol order', {exact:true})).toBeVisible();
      if (scenario === 'cow-buy') await expect(page.getByText('Maximum sold', {exact:true})).toBeVisible();
      if (scenario === 'cow-partial') {
        await expect(page.getByText('Signed fee (full order)', {exact:true})).toBeVisible();
        await expect(page.getByText('Balancer Vault external', {exact:true})).toBeVisible();
      }
    }
    await noOverflow(page); assert.deepEqual(errors, []);
    results.push(`${scenario}: passed`); await page.close();
  }
  for (const options of [{disabled:true}, {metadataMissing:true}]) {
    const {page, errors} = await open(options);
    if (options.disabled) {
      await expect(page.getByText('Primary type', {exact:true})).toBeVisible();
      await expect(page.getByText('CoW Protocol order', {exact:true})).toHaveCount(0);
    } else {
      await expect(page.getByText('1000000 (base units)', {exact:true})).toBeVisible();
      await expect(page.getByRole('button', {name:'Show Unknown token contract'})).toBeVisible();
      await expect(page.getByText('USDC', {exact:true})).toHaveCount(0);
    }
    assert.deepEqual(errors, []); results.push(`${JSON.stringify(options)}: passed`); await page.close();
  }
  await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  console.log(results.join('\n'));
  console.log(`Screenshots and results: ${output}`);
} finally { await browser.close(); }
