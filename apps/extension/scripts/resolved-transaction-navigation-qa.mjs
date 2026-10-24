/** Browser lifecycle regression; synthetic storage only, no signing or submission. */
import { chromium, expect } from '@playwright/test';

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const base = process.env.PREVIEW_URL || 'http://localhost:4317';
try {
  for (const wallet of ['privateKey', 'seedPhrase', 'ledger', 'trezor', 'bankr', 'impersonator']) {
    for (const scenario of ['storage', 'focus', 'already-resolved', 'popup', 'selection-changed']) {
      const page = await browser.newPage();
      await page.route('**/src/preview/index.tsx*', route => route.fulfill({
        contentType: 'application/javascript',
        body: `
          import React from '/node_modules/.vite/deps/react.js';
          import ReactDOMClient from '/node_modules/.vite/deps/react-dom_client.js';
          import { useResolvedTransactionNavigation } from '/src/app/hooks/useResolvedTransactionNavigation.ts';
          let pending = ${scenario === 'already-resolved' ? '[]' : "[{id:'a', accountType:'" + wallet + "'}]"};
          const listeners = new Set();
          window.chrome = {storage: {local: {get: async () => ({pendingTxRequests: pending})},
            onChanged: {addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn)}}};
          let select;
          window.qa = {
            remove(notify = true) { pending = []; if (notify) for (const fn of listeners) fn({pendingTxRequests:{}}, 'local'); },
            focus() { window.dispatchEvent(new Event('focus')); },
            changeSelection() { select('b'); },
          };
          function Harness() {
            const [view, setView] = React.useState('Confirm');
            const [id, setId] = React.useState('a'); select = setId;
            useResolvedTransactionNavigation({enabled: ${scenario !== 'popup'} && view === 'Confirm', requestId: id,
              onResolved: () => setView('Activity')});
            return React.createElement('div', null, view + ':' + id);
          }
          ReactDOMClient.createRoot(document.getElementById('preview-root')).render(React.createElement(Harness));
        `,
      }));
      await page.goto(base + '/preview');
      if (scenario === 'already-resolved') {
        await expect(page.getByText('Activity:a', {exact: true})).toBeVisible();
      } else {
        await expect(page.getByText('Confirm:a', {exact: true})).toBeVisible();
        if (scenario === 'selection-changed') {
          // A new request selection must reconcile independently of the old one.
          await page.evaluate(() => window.qa.changeSelection());
          await expect(page.getByText('Activity:b', {exact: true})).toBeVisible();
        } else {
          await page.evaluate(notify => window.qa.remove(notify), scenario !== 'focus');
          if (scenario === 'focus') await page.evaluate(() => window.qa.focus());
          if (scenario === 'popup') {
            await page.waitForTimeout(100);
            await expect(page.getByText('Confirm:a', {exact: true})).toBeVisible();
          } else await expect(page.getByText('Activity:a', {exact: true})).toBeVisible();
        }
      }
      await page.close();
    }
    console.log(wallet + ': all lifecycle scenarios passed');
  }
} finally { await browser.close(); }
