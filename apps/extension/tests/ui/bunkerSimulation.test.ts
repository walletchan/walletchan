import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { shouldConfirmSimulationFailure } from "../../src/components/RequestConfirmation/simulationFailure";

function harness(file: string, name: string, props: any) {
  const slots: any[] = [], effects: (() => void)[] = [], timers = new Map<number, () => void>();
  const messages: any[] = [];
  let cursor = 0, dirty = false, timerId = 0;
  const hooks = {
    useState(initial: any) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (value: any) => {
        const next = typeof value === "function" ? value(slots[index]) : value;
        if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; }
      }];
    },
    useRef(initial: any) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useEffect(callback: () => (() => void) | undefined, dependencies: any[]) {
      const index = cursor++, previous = slots[index];
      if (!previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) {
        effects.push(() => { previous?.cleanup?.(); slots[index] = { dependencies, cleanup: callback() }; });
      }
    },
  };
  const jsx = (type: unknown, value: any) => ({ type, props: value });
  const exports: any = {};
  const source = readFileSync(new URL(`../../src/components/SafeBunker/${file}.tsx`, import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, {
    exports, URL, Date,
    setInterval: () => 1, clearInterval() {},
    setTimeout(callback: () => void) { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout(id: number) { timers.delete(id); },
    chrome: { runtime: { onMessage: { addListener() {}, removeListener() {} } } },
    require(module: string) {
      if (module === "react") return hooks;
      if (module.endsWith("useBunkerSwapPresentation")) return { useBunkerSwapPresentation: () => undefined };
      if (module.endsWith("/simulationFailure")) return { shouldConfirmSimulationFailure };
      if (module === "viem") return { numberToHex: (value: bigint) => `0x${value.toString(16)}` };
      if (module === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "Fragment" };
      if (module === "@/theme") return { useTheme: () => ({ tokens: { borders: { medium: "1px solid" } } }), useStripTokens: () => ({}), useIconChipBg: () => "surface.raised" };
      if (module === "@/components/AssetChangesDisplay") return { __esModule: true, default: "AssetChangesDisplay", SimulationRevertedBanner: "SimulationRevertedBanner" };
      if (module === "./useNativePriceUsd") return { useNativePriceUsd: () => null };
      if (module === "@/constants/chainRegistry") return { CHAIN_REGISTRY: [] };
      if (module === "@/components/feePaymentUi") return { formatTokenAmount: (value: string) => value };
      if (module === "@/lib/gasFormatUtils") return { formatWeiToUsd: () => null };
      if (module === "./requestQueue") return { earlierBunkerRequest: () => null, isUnsignedBunkerRequest: () => true };
      if (module === "./transport") return { bunkerCommand: async (message: any) => {
        messages.push(message);
        if (message.type === "rejectSafeBunkerRequest") {
          if (props.failReject) throw new Error("Signed operation cannot be rejected");
          return { success: true };
        }
        if (props.failGas) throw new Error("Could not prepare Bunker gas payment [feePayment]");
        return { view: { operations: [{ ...props.operation, reviewDigest: "digest", reviewExpiresAt: Date.now() + 60000,
          payerId: "bunker", maxFee: "100", feePayment: { tokenId: "native", tokenBalance: "100000", sufficientBalance: true },
          calls: props.operation.calls.map((call: any) => ({ ...call, value: "1000" })) }] } };
      } };
      return new Proxy({}, { get: (_target, key) => key });
    },
  });
  return {
    messages,
    render() {
      let tree: any;
      for (let pass = 0; pass < 20; pass++) {
        cursor = 0; dirty = false; tree = exports[name](props);
        while (effects.length) effects.shift()!();
        if (!dirty) return tree;
      }
      throw new Error("render did not settle");
    },
    async runTimers() {
      const pending = [...timers.values()]; timers.clear(); pending.forEach(callback => callback());
      for (let tick = 0; tick < 8; tick++) await Promise.resolve();
    },
  };
}

function find(node: any, type: string): any {
  if (!node || typeof node !== "object") return undefined;
  if (node.type === type) return node.props;
  for (const child of [node.props?.children].flat()) { const result = find(child, type); if (result) return result; }
}
const operation = { id: "request", state: "queued", kind: "transaction", createdAt: 1,
  calls: [{ to: `0x${"22".repeat(20)}`, value: "5000", data: "0x", operation: 0 }], origins: ["https://tx.eth.sh"] };
const account = { id: "bunker", bunkerId: "journal" };
const view = { chainId: 8453, nativeCurrencySymbol: "ETH", safeAddress: `0x${"11".repeat(20)}`, operations: [operation] };
function confirmation(nativeMax = false, error?: string, state = "queued", overrides: any = {}) {
  return harness("BunkerTransactionConfirmation", "BunkerTransactionConfirmation", {
    account, view, operation: { ...operation, state, ...(state === "pending" ? { txHash: "0xhash" } : {}), error, ...(nativeMax ? { nativeMax: true } : {}) }, queue: [operation],
    onBack() {}, onReload: async () => {}, onSubmitted() {}, onSelect() {}, onRejected() {}, ...overrides,
  });
}

test("Bunker preview forwards the standard simulation callbacks without extra lifecycle state", () => {
  const onLoadingChange = () => {}, onRevertedChange = () => {}, onUnavailableChange = () => {};
  const h = harness("BunkerAssetPreview", "BunkerAssetPreview", {
    safe: view.safeAddress, chainId: 8453, chainName: "Base", operation,
    onLoadingChange, onRevertedChange, onUnavailableChange,
  });
  const preview = find(h.render(), "AssetChangesDisplay");
  assert.equal(preview.onSimulationLoadingChange, onLoadingChange);
  assert.equal(preview.onRevertedChange, onRevertedChange);
  assert.equal(preview.onSimulationUnavailableChange, onUnavailableChange);
});

test("Bunker reverts use the EOA body warning and shared confirmation acknowledgement", async () => {
  const h = confirmation(); let tree = h.render();
  const preview = find(tree.props.financialImpact, "BunkerAssetPreview");
  preview.onLoadingChange(false); preview.onRevertedChange(true);
  h.render(); await h.runTimers(); tree = h.render();
  assert.ok(find(tree.props.context, "SimulationRevertedBanner"));
  assert.equal(find(tree.props.actionNotice, "SimulationRevertedBanner"), undefined);
  assert.equal(tree.props.confirmAction.type, "SimulationFailureConfirmButton");
  assert.equal(tree.props.confirmAction.props.simulationFailed, true);
  assert.equal(tree.props.confirmAction.props.isDisabled, false, "shared acknowledgement can proceed when an authoritative review exists");
  assert.ok(find(tree.props.actionSummary, "FeePaymentSelector"), "keep the standard gas-token controls");
  assert.ok(tree.props.rejectAction);
});

test("a failed Bunker gas review uses the EOA gas error component and cannot bypass a missing quote", async () => {
  const h = confirmation(false, undefined, "queued", { failGas: true }); let tree = h.render();
  const preview = find(tree.props.financialImpact, "BunkerAssetPreview");
  preview.onLoadingChange(false); preview.onRevertedChange(true);
  h.render(); await h.runTimers(); tree = h.render();
  const warning = find(tree.props.actionNotice, "RevertWarning");
  assert.equal(warning.shortError, "Execution reverted during simulation.");
  assert.match(warning.fullError, /feePayment/);
  assert.equal(typeof warning.onRetry, "function");
  assert.equal(tree.props.confirmAction.props.isDisabled, true);
  assert.match(tree.props.confirmAction.props.disabledReason, /valid gas review/);
});

test("unavailable previews stay distinct from known reverts", async () => {
  const h = confirmation(); let tree = h.render();
  const preview = find(tree.props.financialImpact, "BunkerAssetPreview");
  preview.onUnavailableChange(true); preview.onLoadingChange(false);
  h.render(); await h.runTimers(); tree = h.render();
  assert.equal(tree.props.confirmAction.props.simulationFailed, false);
  assert.equal(tree.props.confirmAction.props.isDisabled, false);
});

test("MAX re-simulation blocks Confirm without discarding the existing gas review", async () => {
  const h = confirmation(true); let tree = h.render();
  find(tree.props.financialImpact, "BunkerAssetPreview").onLoadingChange(false);
  h.render(); await h.runTimers(); tree = h.render();
  const preview = find(tree.props.financialImpact, "BunkerAssetPreview");
  assert.equal(preview.operation.calls[0].value, "1000");
  preview.onLoadingChange(true); tree = h.render();
  assert.equal(tree.props.confirmAction.props.isDisabled, true);
  await h.runTimers(); assert.equal(h.messages.length, 1);
  preview.onLoadingChange(false); tree = h.render();
  assert.equal(tree.props.confirmAction.props.isDisabled, false);
  await h.runTimers(); assert.equal(h.messages.length, 1);
});

test("pending operation status errors retain the standard retry notice", () => {
  const message = "Gas service did not acknowledge submission";
  const h = confirmation(false, message, "pending"); let tree = h.render();
  find(tree.props.financialImpact, "BunkerAssetPreview").onRevertedChange(true);
  tree = h.render();
  assert.equal(find(tree.props.actionNotice, "RequestRetryNotice").error, message);
  assert.equal(find(tree.props.context, "SimulationRevertedBanner"), undefined);
});

test("swap revert warning stays outside collapsed transactions without a Request details heading", () => {
  const h = confirmation(false, undefined, "queued", { presentation: {
    title: "Confirm Swap", blocked: false, confirmLabel: "Confirm", rejectLabel: "Cancel",
    content: (children: any) => ({ type: "SwapTransactionsCollapse", props: { children } }),
  } });
  let tree = h.render();
  find(tree.props.financialImpact, "BunkerAssetPreview").onRevertedChange(true);
  tree = h.render();
  assert.ok(find(tree.props.context, "SimulationRevertedBanner"));
  assert.equal(tree.props.contextTitle, null);
});


const swapContext = { slippageBps: 50,
  sell: { address: "native", name: "Ether", symbol: "ETH", decimals: 18, amount: "1000000000000000", priceUsd: 2000, logo: null },
  buy: { address: `0x${"22".repeat(20)}`, name: "USD Coin", symbol: "USDC", decimals: 6, amount: "1900000", priceUsd: 1, logo: null } };
function findButton(node: any, label: string): any {
  if (!node || typeof node !== "object") return undefined;
  if (node.type === "Button" && node.props.children === label) return node.props;
  for (const child of [node.props?.children].flat()) { const result = findButton(child, label); if (result) return result; }
}

test("refresh rejects the unsigned swap before opening normal fresh quote preparation", async () => {
  const resumed: any[] = [];
  const h = confirmation(false, undefined, "queued", { operation: { ...operation, swapContext }, failGas: true, onRefreshSwap: (context: any) => resumed.push(context) });
  h.render(); await h.runTimers();
  find(h.render().props.actionNotice, "RequestRetryNotice").onRetry();
  h.render(); await h.runTimers();
  assert.ok(h.messages.some(message => message.type === "rejectSafeBunkerRequest"));
  assert.deepEqual(resumed, [swapContext]);
});

test("refresh cannot discard an operation that became signed in another window", async () => {
  const resumed: any[] = []; let reloads = 0;
  const h = confirmation(false, undefined, "queued", { operation: { ...operation, swapContext }, failGas: true, failReject: true, onRefreshSwap: (context: any) => resumed.push(context), onReload: async () => { reloads++; } });
  h.render(); await h.runTimers();
  find(h.render().props.actionNotice, "RequestRetryNotice").onRetry();
  h.render(); await h.runTimers();
  assert.equal(resumed.length, 0);
  assert.equal(reloads, 1, "reload the signed operation instead of replacing it");
});

test("grouped swaps use the existing separation action before individual review", () => {
  const h = confirmation(false, undefined, "queued", { operation: { ...operation, requiresSwapSeparation: true } });
  const tree = h.render();
  assert.ok(findButton(tree.props.actionSummary, "Separate to review swaps"));
  assert.equal(tree.props.confirmAction.props.isDisabled, true);
});


test("a fresh Bunker swap keeps the normal clean review and refreshes only through error Retry", async () => {
  const resumed: any[] = [];
  const h = confirmation(false, undefined, "queued", { operation: { ...operation, swapContext }, onRefreshSwap: (context: any) => resumed.push(context) });
  let tree = h.render();
  assert.equal(findButton(tree.props.actionSummary, "Refresh swap quote"), undefined);
  await h.runTimers(); tree = h.render();
  assert.equal(findButton(tree.props.actionSummary, "Refresh swap quote"), undefined);
  assert.equal(tree.props.actionNotice, undefined);
  assert.equal(resumed.length, 0);
  find(tree.props.actionSummary, "FeePaymentSelector").onQuoteErrorRetry();
  h.render(); await h.runTimers();
  assert.deepEqual(resumed, [swapContext], "ERC20 quote-error Retry uses the same refresh path");
});
