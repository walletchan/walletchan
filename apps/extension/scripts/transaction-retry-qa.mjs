/** Synthetic UI regression: never signs or broadcasts. Run against pnpm dev:preview. */
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({headless:true, channel:'chrome'});
const base = process.env.PREVIEW_URL || 'http://localhost:4317';
async function open(wallet, width=360, theme='midnight', failure='none') {
  const page = await browser.newPage({viewport:{width,height:900}});
  page.setDefaultTimeout(20000);
  page.on('pageerror', error=>console.error(error.message));
  await page.route('**/src/preview/index.tsx*', route=>route.fulfill({contentType:'application/javascript',body:`
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOMClient from '/node_modules/.vite/deps/react-dom_client.js';
    import { ThemeProvider, SELECTED_THEME_STORAGE_KEY } from '/src/theme/index.ts';
    import { NetworksProvider } from '/src/contexts/NetworksContext.tsx';
    import { installPreviewChrome } from '/src/preview/previewChrome.ts';
    import { createPreviewTxScenario } from '/src/preview/fixtures.ts';
    import TransactionConfirmation from '/src/components/TransactionConfirmation/TransactionConfirmation.tsx';
    import '/src/index.css'; import '/src/preview/preview.css';
    installPreviewChrome();
    localStorage.setItem(SELECTED_THEME_STORAGE_KEY,'${theme}');
    await chrome.storage.local.set({[SELECTED_THEME_STORAGE_KEY]:'${theme}'});
    document.body.classList.add('preview-canvas');
    const request=createPreviewTxScenario('${wallet === 'ledger' || wallet === 'trezor' ? 'privateKey' : wallet}','readme-review');
    request.accountType='${wallet === 'viewOnly' ? 'impersonator' : wallet}';
    window.__retryQA={calls:[], pending:true, delay:0, confirms:0, failure:'${failure}'};
    const original=chrome.runtime.sendMessage;
    chrome.runtime.sendMessage=(message, callback)=>{
      const qa=window.__retryQA; qa.calls.push(message.type);
      if(message.type.startsWith('confirmTransaction')) {
        qa.confirms++;
        const result={success:false,error:'RPC request failed. Please try again.'};
        setTimeout(()=>callback?.(result),0); return Promise.resolve(result);
      }
      if(message.type==='getPendingTransaction') {
        const result=qa.pending?{tx:request.tx}:null;
        setTimeout(()=>callback?.(result),qa.delay); return Promise.resolve(result);
      }
      if ((qa.failure==='gas' && message.type==='estimateGas') || (qa.failure==='simulation' && message.type==='simulateAssetChanges')) {
        setTimeout(()=>callback?.(null),0); return Promise.resolve(null);
      }
      return original(message,callback?(result)=>setTimeout(()=>callback(result),qa.delay):undefined);
    };
    ReactDOMClient.createRoot(document.getElementById('preview-root')).render(
      React.createElement(ThemeProvider,null,React.createElement(NetworksProvider,null,
        React.createElement(TransactionConfirmation,{txRequest:request,accountType:'${wallet === 'viewOnly' ? 'impersonator' : wallet}',
          currentIndex:0,totalCount:1,isInSidePanel:true,onBack(){},onConfirmed(){},onRejected(){},onRejectAll(){},onNavigate(){}}))));
  `}));
  await page.goto(base+'/preview/tx?canvas=1&wallet=privateKey&scenario=readme-review');
  return page;
}
try {
  for(const wallet of ['privateKey','seedPhrase','ledger','trezor','bankr']) {
    const page=await open(wallet);
    const confirm=page.getByRole('button',{name:'Confirm',exact:true});
    await expect(confirm).toBeEnabled(); await confirm.click();
    const error=page.getByRole('alert').filter({hasText:'RPC request failed'});
    await expect(error).toBeVisible(); await expect(confirm).toBeDisabled();
    const retry=page.getByRole('button',{name:'Retry',exact:true});
    const er=await error.boundingBox(), rr=await retry.boundingBox();
    assert.ok(rr.x>=er.x+er.width-1,'Retry is right of footer error');
    const before=await page.evaluate(()=>window.__retryQA.calls.filter(x=>x==='simulateAssetChanges').length);
    await page.evaluate(()=>window.__retryQA.delay=600);
    const retryElement = await retry.elementHandle();
    await retry.click();
    await retryElement.evaluate(button=>button.click());
    assert.equal(await page.evaluate(()=>window.__retryQA.calls.filter(x=>x==='getPendingTransaction').length),1,'ignores repeated retry');
    await expect(page.getByRole('button',{name:/Preparing/})).toBeDisabled();
    await expect(confirm).toBeEnabled();
    assert.equal(await page.evaluate(()=>window.__retryQA.confirms),1,'Retry cannot confirm');
    assert.ok(await page.evaluate(()=>window.__retryQA.calls.filter(x=>x==='simulateAssetChanges').length)>before,'reruns simulation');
    await confirm.click(); await expect(error).toBeVisible();
    await page.evaluate(()=>{window.__retryQA.pending=false;window.__retryQA.delay=0;});
    await retry.click();
    await expect(page.getByText('This request is no longer pending. Check Activity for its status.',{exact:true})).toBeVisible();
    await expect(confirm).toBeDisabled(); await expect(retry).toHaveCount(0);
    assert.equal(await page.evaluate(()=>window.__retryQA.confirms),2,'consumed request cannot resubmit');
    console.log(wallet+': footer retry, fresh review, loading guard, consumed-request guard passed');
    await page.close();
  }
  for (const width of [320, 640]) for (const theme of ['midnight', 'bauhaus']) {
    const page=await open('privateKey',width,theme,'simulation');
    const warning=page.getByRole('alert').filter({hasText:'Asset preview unavailable'});
    await expect(warning).toBeVisible();
    const retry=page.getByRole('button',{name:'Retry',exact:true});
    const wr=await warning.boundingBox(), rr=await retry.boundingBox();
    assert.ok(rr.x>=wr.x+wr.width-1 && rr.x+rr.width<=width,'responsive right-aligned retry');
    await page.screenshot({path:`/tmp/tx-retry-warning-${theme}-${width}.png`});
    await page.evaluate(()=>{window.__retryQA.failure='none';window.__retryQA.delay=600;});
    await retry.click();
    await expect(page.getByRole('button',{name:/Preparing/})).toBeDisabled();
    await expect(warning).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Confirm',exact:true})).toBeEnabled();
    await page.screenshot({path:`/tmp/tx-retry-${theme}-${width}.png`});
    await page.close();
  }
  const gas=await open('privateKey',360,'midnight','gas');
  await expect(gas.getByRole('alert').filter({hasText:'Gas estimate unavailable'})).toBeVisible();
  await gas.evaluate(()=>window.__retryQA.failure='none');
  await gas.getByRole('button',{name:'Retry',exact:true}).click();
  await expect(gas.getByRole('button',{name:'Confirm',exact:true})).toBeEnabled();
  assert.equal(await gas.evaluate(()=>window.__retryQA.confirms),0);
  await gas.close();
  const viewOnly=await open('viewOnly',360,'midnight','simulation');
  await expect(viewOnly.getByRole('alert').filter({hasText:'Asset preview unavailable'})).toBeVisible();
  await viewOnly.evaluate(()=>window.__retryQA.failure='none');
  await viewOnly.getByRole('button',{name:'Retry',exact:true}).click();
  await expect(viewOnly.getByRole('alert').filter({hasText:'Asset preview unavailable'})).toHaveCount(0);
  await expect(viewOnly.getByRole('button',{name:'Confirm',exact:true})).toHaveCount(0);
  assert.equal(await viewOnly.evaluate(()=>window.__retryQA.confirms),0);
  await viewOnly.close();
  console.log('Responsive themes, unavailable simulation, gas RPC failure, and reject-only view-only passed');
} finally {await browser.close();}
