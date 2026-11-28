import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { selectBunkerRequest, isPendingBunkerRequest } from "../../src/components/SafeBunker/requestQueue";
import { isBunkerExecutionInFlight } from "../../src/chrome/safeBunker/requestPolicy";

function harness(isPopup = false, presentation?: any) {
  const account = { id: "bunker", bunkerId: "journal", chainId: 8453, seedGroupId: "seed", address: `0x${"11".repeat(20)}` };
  const queued = { id: "request", state: "reviewed", kind: "transaction", createdAt: 1 };
  let snapshot: any = { id: account.id, draftId: account.bunkerId, chainId: account.chainId, seedGroupId: account.seedGroupId, safeAddress: account.address, operations: [queued] };
  const slots: any[] = [], effects: Array<() => unknown> = [], cleanups: Array<() => void> = [], timers = new Map<number, { work: () => void; ms: number }>();
  let cursor = 0, activity = 0, closed = 0, backed = 0, poll: (() => void) | undefined;
  const jsx = (type: unknown, props: any) => ({ type, props });
  const exports: any = {};
  const source = readFileSync(new URL("../../src/components/SafeBunker/BunkerAccountScreen.tsx", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, Error, window: { close: () => { closed++; } },
    setInterval: (work: () => void) => { poll = work; return 1; }, clearInterval() {},
    setTimeout: (work: () => void, ms: number) => { const id = timers.size + 1; timers.set(id, { work, ms }); return id; }, clearTimeout: (id: number) => timers.delete(id),
    require: (name: string) => {
      if (name === "react") return {
        useState(initial: unknown) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], (v: any) => { slots[i] = typeof v === "function" ? v(slots[i]) : v; }]; },
        useRef(initial: unknown) { const i = cursor++; return slots[i] ??= { current: initial }; },
        useEffect(work: () => void, deps: unknown[]) { const i = cursor++; const prev = slots[i]; if (!prev || deps.some((v, k) => v !== prev[k])) effects.push(work); slots[i] = deps; },
      };
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "./transport") return { bunkerCommand: async () => ({ view: structuredClone(snapshot) }) };
      if (name === "./requestQueue") return { selectBunkerRequest, isPendingBunkerRequest };
      if (name.endsWith("requestPolicy")) return { isBunkerExecutionInFlight };
      if (name.endsWith("InitialRequestLoadingScreen")) return { __esModule: true, default: "InitialRequestLoadingScreen" };
      return new Proxy({}, { get: (_target, key) => key });
    },
  });
  const render = () => { cursor = 0; const tree = exports.BunkerAccountScreen({ account, initialRequestId: "request", initialView: snapshot, isPopup, presentation, rejectOnBack: !!presentation, onBack() { backed++; }, onSubmitted() { activity++; } }); effects.splice(0).forEach(work => { const cleanup = work(); if (typeof cleanup === "function") cleanups.push(cleanup as () => void); }); return tree; };
  return { render, timers, unmount() { cleanups.splice(0).forEach(work => work()); }, get activity() { return activity; }, get backed() { return backed; }, get closed() { return closed; }, async refresh(state: string, another = false) {
    snapshot = { ...snapshot, operations: [{ ...queued, state, userOperationHash: `0x${"22".repeat(32)}` }, ...(another ? [{ ...queued, id: "next" }] : [])] };
    poll?.(); await Promise.resolve(); await Promise.resolve();
  } };
}

test("polling cannot unmount a confirming request or switch to the next approval before completion", async () => {
  const h = harness();
  const child = h.render(); assert.equal(child.type, "BunkerTransactionConfirmation");
  child.props.onConfirming(true); h.render();
  await h.refresh("pending", true);
  const retained = h.render(); assert.equal(retained.type, "BunkerTransactionConfirmation"); assert.equal(retained.props.operation.id, "request"); assert.equal(h.activity, 0);
  retained.props.onConfirming(false); h.render();
  assert.equal(h.activity, 1);
  child.props.onSubmitted(); assert.equal(h.activity, 1, "late callbacks do not repeat completion");
});

test("sidepanel completion opens Activity exactly once without scheduling popup close", () => {
  const h = harness(); const child = h.render(); child.props.onSubmitted(); child.props.onSubmitted();
  assert.equal(h.activity, 1); assert.equal(h.timers.size, 0); assert.equal(h.closed, 0);
});

test("popup completion reuses the sent checkmark screen and closes after its animation", () => {
  const h = harness(true); const child = h.render(); child.props.onSubmitted();
  const sent = h.render(); assert.equal(sent.type, "TransactionSentScreen"); assert.equal(h.activity, 0);
  const timer = [...h.timers.values()][0]; assert.equal(timer.ms, 1000); timer.work(); assert.equal(h.closed, 1);
});

test("ambiguous submission leaves approval for Activity without a success animation or popup close", async () => {
  const h = harness(true); h.render();
  await h.refresh("ambiguous");
  const tree = h.render(); assert.equal(tree.type, "InitialRequestLoadingScreen"); assert.equal(h.activity, 1); assert.equal(h.timers.size, 0); assert.equal(h.closed, 0);
});


test("a released operation that expires during confirmation still routes to Activity without success", async () => {
  const h = harness(true); const child = h.render();
  child.props.onConfirming(true); h.render();
  await h.refresh("invalidated");
  const retained = h.render(); assert.equal(retained.type, "BunkerTransactionConfirmation");
  retained.props.onConfirming(false); h.render();
  assert.equal(h.activity, 1); assert.equal(h.timers.size, 0);
});


test("late completion after unmount cannot navigate or animate over a newer request", () => {
  const h = harness(true); const child = h.render(); h.unmount(); child.props.onSubmitted();
  assert.equal(h.activity, 0); assert.equal(h.timers.size, 0); assert.equal(h.closed, 0);
});


test("inline swap presentation is scoped to its request and cancel returns to swap form", () => {
  const presentation = { title: "Confirm Swap", content: "swap-overview", blocked: true };
  const h = harness(false, presentation);
  const child = h.render();
  assert.equal(child.props.presentation, presentation);
  assert.equal(child.props.rejectOnBack, true);
  child.props.onRejected(["request"]);
  assert.equal(h.backed, 1);
});


test("swap completion selects Activity even when the Assets trigger is ahead", () => {
  const source = readFileSync(new URL("../../src/App.tsx", import.meta.url), "utf8");
  const navigate = source.match(/const returnToActivity = useCallback\((\(\) => \{[\s\S]*?\}), \[holdingsTabTrigger\]\)/)?.[1];
  const submitted = source.match(/onSwapInitiated=\{(\(\) => \{[\s\S]*?\n\s*\})\}/)?.[1];
  assert.ok(navigate); assert.ok(submitted);
  for (const [activity, holdings] of [[0, 9], [4, 4], [12, 3]]) {
    const state = { activity, view: "swap", mode: "private", buy: "USDC" as string | undefined, sell: "ETH" as string | undefined };
    vm.runInNewContext(`const returnToActivity = ${navigate}; (${submitted})();`, {
      holdingsTabTrigger: holdings,
      setActivityTabTrigger: (update: (prior: number) => number) => { state.activity = update(state.activity); },
      setView: (value: string) => { state.view = value; },
      setWalletHomeMode: (value: string) => { state.mode = value; },
      setSwapInitialBuyToken: (value: undefined) => { state.buy = value; },
      setSwapInitialSellToken: (value: undefined) => { state.sell = value; },
    });
    assert.ok(state.activity > holdings, "Activity must win the Portfolio tab selector");
    assert.equal(state.view, "main"); assert.equal(state.mode, "public");
    assert.equal(state.buy, undefined); assert.equal(state.sell, undefined);
  }
});
