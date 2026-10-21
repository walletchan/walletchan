import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { createServer, type Plugin } from "vite";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// Exercise the production React loader with controllable catalog/RPC boundaries.
// Keep every intermediate render so even a one-frame empty portfolio fails.
const harness = `
import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { useHoldingsState } from '/src/components/Portfolio/Holdings/useHoldingsState.ts';
import { usePortfolioLoader } from '/src/components/Portfolio/Holdings/usePortfolioLoader.ts';
window.chrome = { storage: { sync: { get: (_, callback) => callback({}) } } };
const native = { symbol: 'ETH', name: 'Ether', contractAddress: 'native', chainId: 84532,
  decimals: 18, balance: '0.25', balanceFormatted: '0.25', priceUsd: 0, valueUsd: 0 };
const custom = { ...native, symbol: 'CUSTOM', contractAddress: '0x0000000000000000000000000000000000000001',
  balance: '2', balanceFormatted: '2', priceUsd: 3, valueUsd: 6 };
const keys = new Set(['84532-native', '84532-' + custom.contractAddress]);
window.snapshot = { tokens: [native, custom], defiPositions: [], totalValueUsd: 6,
  omittedTokenCount: 0, omittedTokenValueUsd: 0, omittedTokenValueUsdByChain: {},
  customTokenKeys: keys, allTokenKeys: keys, hiddenTokenKeys: new Set(),
  onchainFetchedTokenKeys: keys, rpcIssueChainIds: [], apiUnavailable: false, timestamp: Date.now() };
window.catalog = { ...window.snapshot, tokens: window.snapshot.tokens.map(t => ({ ...t,
  balance: '0', balanceFormatted: '0', valueUsd: 0 })), recentReceivedTokenKeys: new Set() };
window.renders = [];
function Harness() {
  const state = useHoldingsState({ address: '0x0000000000000000000000000000000000000002', chainReloadKey: 'test' });
  const load = usePortfolioLoader({ address: '0x0000000000000000000000000000000000000002', chainReloadKey: 'test', state });
  window.refresh = () => load(true, { suppressSkeleton: true,
    forceRefreshTokenKeys: keys });
  useEffect(() => { state.applyHoldingsSnapshot(window.snapshot); void window.refresh(); }, []);
  window.renders.push(state.tokens.map(t => t.balance));
  return React.createElement('pre', { id: 'balances' }, JSON.stringify(state.tokens.map(t => t.balance).sort()));
}
createRoot(document.getElementById('root')).render(React.createElement(Harness));
`;

function harnessPlugin(): Plugin {
  const mocks: Record<string, string> = {
    "@/chrome/portfolio/tokenCatalog": `export async function loadPortfolioTokenCatalog() { return window.catalog; }`,
    "@/chrome/portfolio/onchainBalances": `export function fetchOnchainBalances() {
      return new Promise(resolve => { window.finishRpc = (mode) => resolve({
        tokens: window.catalog.tokens.map(t => ({ ...t, balance: mode === 'zero' ? '0' : t.symbol === 'ETH' ? '0.25' : '2',
          balanceFormatted: mode === 'zero' ? '0' : t.symbol === 'ETH' ? '0.25' : '2' })),
        verifiedTokenKeys: mode === 'failed' ? new Set() : window.snapshot.onchainFetchedTokenKeys,
        rpcHealth: { checkedChainIds: [84532], unhealthyChainIds: mode === 'failed' ? [84532] : [] }
      }); });
    }`,
    "@/chrome/portfolio/tokenPageEnrichment": `export async function enrichPortfolioTokenPage(tokens) { return tokens; }`,
    "@/chrome/portfolio/snapshotStorage": `export async function recordSnapshot() { return false; }`,
    "./cache": `export const holdingsCacheKey = (address, key) => address + '|' + key;
      export const readCachedHoldingsSnapshot = () => window.snapshot;
      export async function clearHoldingsCaches() {}
      export const schedulePortfolioBackgroundTask = task => { void task(); };
      export const writeHoldingsSnapshot = (_, snapshot) => { window.saved = snapshot; };`,
  };
  return {
    name: "cached-rpc-refresh-harness",
    enforce: "pre",
    resolveId(source, importer) {
      if (source === "/cached-rpc-harness.js") return "\0cached-rpc-harness.js";
      const key = Object.keys(mocks).find(key => source === key ||
        (key.startsWith("@/") && source === path.join(APP_DIR, "src", key.slice(2))));
      if (key && (key !== "./cache" || importer?.includes("/Portfolio/Holdings/"))) {
        return `\0rpc-mock:${key}`;
      }
    },
    load(id) {
      if (id === "\0cached-rpc-harness.js") return harness;
      if (id.startsWith("\0rpc-mock:")) return mocks[id.slice("\0rpc-mock:".length)];
    },
    configureServer(server) {
      server.middlewares.use("/cached-rpc-refresh", (_req, res) => {
        res.setHeader("Content-Type", "text/html");
        res.end('<div id="root"></div><script type="module" src="/cached-rpc-harness.js"></script>');
      });
    },
  };
}

test("cached RPC-only balances survive reopening, revalidation and failed reads until a verified zero", { timeout: 30_000 }, async () => {
  const server = await createServer({
    root: APP_DIR,
    configFile: path.join(APP_DIR, "vite.config.preview.ts"),
    plugins: [harnessPlugin()],
    server: { host: "127.0.0.1", port: 0, hmr: false },
  });
  await server.listen();
  const browser = await chromium.launch({ headless: true });
  try {
    const address = server.httpServer!.address();
    assert.ok(address && typeof address !== "string");
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.setDefaultTimeout(5_000);
    for (let reopen = 0; reopen < 2; reopen++) {
      await page.goto(`http://127.0.0.1:${address.port}/cached-rpc-refresh`);
      await page.waitForFunction(() => typeof (window as any).finishRpc === "function");
      assert.deepEqual(errors, []);
      assert.equal(await page.locator("#balances").textContent(), '["0.25","2"]');
      assert.ok((await page.evaluate(() => (window as any).renders)).every(
        (balances: string[]) => balances.length === 2,
      ), "no intermediate render may discard cached RPC-only holdings");

      for (const mode of ["success", "failed", "zero"]) {
        if (mode !== "success") {
          await page.evaluate(async () => {
            (window as any).finishRpc = undefined;
            (window as any).saved = undefined;
            await (window as any).refresh();
          });
          await page.waitForFunction(() => typeof (window as any).finishRpc === "function");
          assert.equal(await page.locator("#balances").textContent(), '["0.25","2"]');
        }
        await page.evaluate(mode => (window as any).finishRpc(mode), mode);
        await page.waitForFunction(() => Boolean((window as any).saved));
        if (mode === "zero") {
          await page.waitForFunction(() => document.querySelector("#balances")?.textContent === "[]");
        } else {
          assert.equal(await page.locator("#balances").textContent(), '["0.25","2"]');
          assert.equal(await page.evaluate(() => (window as any).saved.tokens.length), 2);
        }
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }
});
