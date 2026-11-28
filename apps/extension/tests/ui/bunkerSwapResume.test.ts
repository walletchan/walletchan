import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { formatUnits } from "viem";

const context = { slippageBps: 50,
  sell: { address: "native", name: "Ether", symbol: "ETH", decimals: 18, amount: "1000000000000000", priceUsd: 2000, logo: null },
  buy: { address: `0x${"22".repeat(20)}`, name: "USD Coin", symbol: "USDC", decimals: 6, amount: "1900000", priceUsd: 1, logo: null } };
const account = { id: "bunker", address: `0x${"11".repeat(20)}` };
const view = { chainId: 8453, chainName: "Base" };
const operation = { id: "swap", swapContext: context, calls: [{ to: context.buy.address, data: "0x12345678", value: "0", operation: 0 }] };
function harness() {
  const slots: any[] = [];
  let cursor = 0, dirty = false;
  const react = {
    useState(initial: any) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], (value: any) => {
      const next = typeof value === "function" ? value(slots[i]) : value;
      if (next !== slots[i]) { slots[i] = next; dirty = true; }
    }]; },
    useRef(initial: any) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useEffect(callback: () => void) { cursor++; callback(); },
  };
  const jsx = (type: any, props: any) => ({ type, props });
  function load(file: string): any {
    const exports: any = {};
    const source = readFileSync(new URL(`../../src/components/Swap/${file}`, import.meta.url), "utf8");
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, {
      exports, require(name: string) {
        if (name === "react") return react;
        if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
        if (name === "viem") return { formatUnits };
        if (name === "@/chrome/swapApi") return { NATIVE_TOKEN_ADDRESS: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" };
        if (name === "./useSwapPriceImpactDecision") return load("useSwapPriceImpactDecision.ts");
        if (name === "./SwapConfirmation") return { __esModule: true, default: "SwapConfirmation" };
        return new Proxy({}, { get: (_target, key) => key });
      },
    }); return exports;
  }
  const api = load("useBunkerSwapPresentation.tsx");
  return { api, render(op = operation, canSwap = false, stagePlan = async () => {}) {
    let result: any;
    for (let pass = 0; pass < 10; pass++) {
      cursor = 0; dirty = false;
      result = api.useBunkerSwapPresentation(account, view, op);
      api.useResumeSwapReview({ context, requestId: op.id, chainId: 8453 }, canSwap, stagePlan);
      if (!dirty) return result;
    }
    throw new Error("render did not settle");
  } };
}

test("reopening uses the real swap overview and resets the existing price-impact acknowledgement", () => {
  const h = harness(); let presentation = h.render();
  assert.equal(presentation.blocked, true, "5% impact requires acknowledgement");
  const overview = presentation.content("estimated changes");
  assert.equal(overview.type, "SwapConfirmation");
  assert.equal(overview.props.transactionDetails, "estimated changes");
  assert.equal(overview.props.sellAmount, "0.001");
  assert.equal(overview.props.buyAmount, context.buy.amount);
  assert.equal(overview.props.transactions[0].tx.data, operation.calls[0].data);
  presentation.notice(false).props.decision.setAcknowledged(true);
  presentation = h.render(); assert.equal(presentation.blocked, false);
  assert.equal(harness().render().blocked, true, "reopening never restores consent");
  const changed = { ...operation, swapContext: { ...context, buy: { ...context.buy, amount: "1800000" } } };
  assert.equal(h.render(changed).blocked, true, "refreshed quote needs a fresh acknowledgement");
});

test("refresh waits for normal Swap readiness and stages its firm quote exactly once", () => {
  const h = harness(); let preparations = 0;
  const prepare = async () => { preparations++; };
  h.render(operation, false, prepare); assert.equal(preparations, 0);
  h.render(operation, true, prepare); h.render(operation, true, prepare);
  assert.equal(preparations, 1);
  assert.equal(h.api.bunkerSwapSellToken(context, 8453).chainId, 8453);
});
