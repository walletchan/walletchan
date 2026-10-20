import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function load(path: string, require: (name: string) => unknown) {
  const exports: any = {};
  const source = readFileSync(new URL(`../../src/${path}`, import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require, Error, setInterval: () => 0, clearInterval() {} });
  return exports;
}
const account = { id: "bunker", type: "safeBunker", bunkerId: "journal", chainId: 84532,
  seedGroupId: "seed", address: "0x1111111111111111111111111111111111111111" };
const view = { id: account.id, draftId: account.bunkerId, chainId: account.chainId,
  seedGroupId: account.seedGroupId, safeAddress: account.address, defaultPayer: null };

test("Bunker opening loads UI and fresh public view together, caching only code", async () => {
  const code = deferred<any>(), data = deferred<any>();
  let reads = 0, codeReads = 0;
  const api = load("app/bunkerRequestPreload.ts", name => {
    if (name.endsWith("transport")) return { bunkerCommand: () => { reads++; return reads === 1 ? data.promise : Promise.resolve({ view: { ...view, defaultPayer: { id: "new-default" } } }); } };
    if (name.endsWith("BunkerAccountScreen")) { codeReads++; return code.promise; }
    throw new Error(`Unexpected dependency: ${name}`);
  });
  const pending = api.preloadBunkerRequest(account);
  await Promise.resolve();
  assert.equal(reads, 1); assert.equal(codeReads, 1);
  assert.equal(api.loadedBunkerRequestScreen(), undefined);
  const Screen = () => null;
  code.resolve({ BunkerAccountScreen: Screen }); data.resolve({ view });
  assert.equal(await pending, view);
  assert.equal(api.loadedBunkerRequestScreen(), Screen);
  assert.equal((await api.preloadBunkerRequest(account)).defaultPayer.id, "new-default");
  assert.equal(reads, 2); assert.equal(codeReads, 1);
});

test("preload rejects public views bound to another source or chain", async () => {
  let wrong = { ...view, chainId: 1 };
  const api = load("app/bunkerRequestPreload.ts", name => name.endsWith("transport")
    ? { bunkerCommand: async () => ({ view: wrong }) } : { BunkerAccountScreen: () => null });
  await assert.rejects(api.preloadBunkerRequest(account), /Bunker account changed/);
  wrong = { ...view, seedGroupId: "another-seed" };
  await assert.rejects(api.preloadBunkerRequest(account), /Bunker account changed/);
});

function navigationHarness() {
  const slots: any[] = [], jobs: ReturnType<typeof deferred<any>>[] = [], navigations: string[] = [];
  let cursor = 0;
  const hooks = {
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (value: any) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(initial: unknown) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useEffect() {}, useCallback: (callback: unknown) => callback,
  };
  const api = load("app/hooks/useBunkerNavigation.ts", name => {
    if (name === "react") return hooks;
    if (name.endsWith("bunkerRequestPreload")) return { preloadBunkerRequest: () => {
      const job = deferred<any>(); jobs.push(job); return job.promise;
    } };
    if (name.endsWith("transport")) return {};
    throw new Error(`Unexpected dependency: ${name}`);
  });
  return { jobs, navigations, render(unlocked = true, accounts = [account]) {
    cursor = 0;
    return api.useBunkerNavigation({ unlocked, accounts, setView: (next: string) => navigations.push(next), onSelectAccount: async () => {}, onActivity: () => navigations.push("activity") });
  } };
}

test("navigation opens the ready confirmation with its snapshot instead of an empty screen", async () => {
  const h = navigationHarness();
  const opening = h.render().openBunker(account, "request");
  assert.deepEqual(h.navigations, []);
  h.jobs[0].resolve(view); await opening;
  assert.deepEqual(h.navigations, ["safeBunker"]);
  const state = h.render();
  assert.equal(state.bunkerInitialView, view);
  assert.equal(state.bunkerRequestId, "request");
});

test("late preloads cannot replace a newer request or reopen after lock/removal", async () => {
  const h = navigationHarness();
  const first = h.render().openBunker(account, "first"), second = h.render().openBunker(account, "second");
  h.jobs[1].resolve(view); await second;
  h.jobs[0].resolve(view); await first;
  assert.equal(h.render().bunkerRequestId, "second");
  const locked = h.render().openBunker(account, "locked");
  h.render(false); h.jobs[2].resolve(view); await locked;
  const removed = h.render().openBunker(account, "removed");
  h.render(true, []); h.jobs[3].resolve(view); await removed;
  assert.deepEqual(h.navigations, ["safeBunker"]);
});

test("failed hydration opens a retryable error instead of silently losing the request", async () => {
  const h = navigationHarness();
  const opening = h.render().openBunker(account, "request");
  h.jobs[0].reject(Error("Wallet unavailable")); await opening;
  assert.deepEqual(h.navigations, ["safeBunker"]);
  assert.equal(h.render().bunkerInitialView, null);
  assert.equal(h.render().bunkerInitialError, "Wallet unavailable");
});

test("the seeded screen renders confirmation immediately without duplicate mount reads", () => {
  const effects: Array<() => unknown> = [];
  let reads = 0;
  const jsx = (type: unknown, props: any) => ({ type, props });
  const api = load("components/SafeBunker/BunkerAccountScreen.tsx", name => {
    if (name === "react") return {
      useState: (initial: unknown) => [initial, () => {}],
      useRef: (current: unknown) => ({ current }),
      useEffect: (effect: () => unknown) => effects.push(effect),
    };
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (name === "./transport") return { bunkerCommand: async () => { reads++; return { view }; } };
    if (name === "./requestQueue") return { isPendingBunkerRequest: () => true, selectBunkerRequest: (queue: unknown[]) => queue[0] };
    if (name.endsWith("requestPolicy")) return { isBunkerExecutionInFlight: () => false };
    return new Proxy({}, { get: (_target, key) => key });
  });
  const snapshot = { ...view, operations: [{ id: "request", state: "queued" }] };
  const screen = api.BunkerAccountScreen({ account, initialView: snapshot, initialRequestId: "request" });
  assert.equal(screen.type, "BunkerTransactionConfirmation");
  assert.equal(screen.props.view, snapshot);
  for (const effect of effects) effect();
  assert.equal(reads, 0);
});


test("late request preloads cannot reopen Bunker after submission routes to Activity", async () => {
  const h = navigationHarness();
  const opening = h.render().openBunker(account, "request");
  h.render().handleBunkerSubmitted(account);
  await Promise.resolve();
  h.jobs[0].resolve(view); await opening;
  assert.deepEqual(h.navigations, ["activity"]);
  assert.equal(h.render().bunkerInitialView, null);
});

test("submission completion cannot navigate after the wallet locks", async () => {
  const h = navigationHarness(); h.render().handleBunkerSubmitted(account); h.render(false);
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(h.navigations, []);
});

test("a newer request wins over an older submission's asynchronous Activity navigation", async () => {
  const h = navigationHarness(); h.render().handleBunkerSubmitted(account);
  const opening = h.render().openBunker(account, "new-request");
  h.jobs[0].resolve(view); await opening;
  assert.deepEqual(h.navigations, ["safeBunker"]);
  assert.equal(h.render().bunkerRequestId, "new-request");
});
