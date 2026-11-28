import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { noBunkersFound } from "../../src/components/SafeBunker/discoveryModel";

function harness(path: string, dependencies: (name: string) => any) {
  let cursor = 0, dirty = false;
  const slots: any[] = [], effects: (() => void)[] = [], cleanups: (() => void)[] = [];
  const jsx = (type: any, props: any) => ({ type, props });
  const hooks = {
    useState(initial: any) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], (value: any) => {
      const next = typeof value === "function" ? value(slots[i]) : value; if (next !== slots[i]) { slots[i] = next; dirty = true; }
    }]; },
    useRef(initial: any) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useEffect(effect: () => any, deps: any[]) {
      const i = cursor++, previous = slots[i];
      if (!previous || deps.some((value, index) => value !== previous[index])) {
        slots[i] = deps; effects.push(() => { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); });
      }
    },
  };
  const exports: any = {};
  const source = readFileSync(new URL(`../../src/${path}`, import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, Error, require(name: string) {
      if (name === "react") return hooks;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      return dependencies(name) ?? new Proxy({}, { get: (_target, key) => key });
    }, chrome: { runtime: { onMessage: { addListener: (listener: any) => listeners.add(listener), removeListener: (listener: any) => listeners.delete(listener) } } },
  });
  const listeners = new Set<(value: any) => void>();
  return { render(name: string, props?: any) {
    let tree: any;
    for (let pass = 0; pass < 20; pass++) {
      cursor = 0; dirty = false; tree = exports[name](props);
      while (effects.length) effects.shift()!();
      if (!dirty) return tree;
    }
    throw new Error("render did not settle");
  }, unmount() { cleanups.forEach(cleanup => cleanup()); }, emit(value: any) { listeners.forEach(listener => listener(value)); } };
}
function nodes(node: any): any[] {
  if (!node || typeof node !== "object") return [];
  return [node, ...[node.props?.children].flat().flatMap(nodes)];
}
const group = { id: "source", name: "Seed", accountCount: 0, createdAt: 1 };

test("dedicated Bunker onboarding is an Import choice and leaves ordinary seed import separate", () => {
  const types = readFileSync(new URL("../../src/pages/onboarding/AccountTypeStep.tsx", import.meta.url), "utf8");
  assert.match(types, /title: "Safe Bunker", type: "safeBunker", group: "Import"/);
  const source = readFileSync(new URL("../../src/pages/Onboarding.tsx", import.meta.url), "utf8");
  assert.match(source, /step === "safeBunker"[\s\S]*?<SeedPhraseOnboardingStep phraseOnly/);
  assert.match(source, /step === "seedPhrase"[\s\S]*?<SeedPhraseOnboardingStep\s/);
});

test("locking or closing cancels both pending discovery and delayed discovery after credential setup", async () => {
  const h = harness("pages/onboarding/useBunkerOnboardingSelection.ts", () => undefined);
  const first = h.render("useBunkerOnboardingSelection");
  const delayed = first.request();
  h.emit({ type: "walletLockedExternal" });
  await assert.rejects(delayed(group), /cancelled/);
  const next = h.render("useBunkerOnboardingSelection");
  const pending = next.request()(group);
  h.unmount(); await assert.rejects(pending, /cancelled/);
  await assert.rejects(next.request()(group), /cancelled/);
});

test("the existing Bunker import list supports partial results without deployment actions", async () => {
  const messages: any[] = [], added: any[] = [];
  let searches = 0, committed = 0;
  const discovery: any = { networks: [{ chainId: 1, name: "Ethereum" }, { chainId: 8453, name: "Base" }], loading: false, checking: false, searched: true,
    results: { source: { 1: { status: "deployed", address: `0x${"11".repeat(20)}` }, 8453: { status: "error" } } },
    find: async () => { searches++; }, refresh() {} };
  const h = harness("components/SafeBunker/BunkerExistingImport.tsx", name => {
    if (name === "./discoveryModel") return { noBunkersFound };
    if (name === "./transport") return { bunkerCommand: async (message: any) => { messages.push(message); return { accountId: "bunker" }; } };
  });
  const props = { seedGroupId: group.id, discovery, autoSearch: true, onAdded: (...args: any[]) => added.push(args), onCommitted: () => { committed++; } };
  let tree = h.render("BunkerExistingImport", props);
  assert.equal(searches, 1);
  assert.equal(nodes(tree).filter(node => node.type === "Checkbox").length, 1, "failed networks do not prevent selection of a verified Bunker");
  assert.doesNotMatch(JSON.stringify(tree), /Deploy on|createSafeBunkerDraft/);
  nodes(tree).find(node => node.type === "Checkbox").props.onChange({ target: { checked: true } });
  tree = h.render("BunkerExistingImport", props);
  await nodes(tree).find(node => node.type === "Button" && node.props.children === "Import selected Bunkers").props.onClick();
  for (let tick = 0; tick < 8; tick++) await Promise.resolve();
  assert.deepEqual(messages.map(message => message.type), ["addExistingSafeBunker"]);
  assert.equal(committed, 1); assert.equal(added[0][0], "bunker"); assert.equal(added[0][1], 1);
});

test("a partial import failure retains committed accounts and offers explicit completion", async () => {
  const added: any[] = [];
  const discovery: any = { networks: [{ chainId: 1, name: "Ethereum" }, { chainId: 8453, name: "Base" }], loading: false, checking: false, searched: true,
    results: { source: { 1: { status: "deployed" }, 8453: { status: "deployed" } } }, find: async () => {}, refresh() {} };
  const h = harness("components/SafeBunker/BunkerExistingImport.tsx", name => {
    if (name === "./discoveryModel") return { noBunkersFound };
    if (name === "./transport") return { bunkerCommand: async (message: any) => { if (message.chainId === 8453) throw new Error("Network unavailable"); return { accountId: "imported" }; } };
  });
  const props = { seedGroupId: group.id, discovery, autoSearch: true, onAdded: (...args: any[]) => added.push(args) };
  let tree = h.render("BunkerExistingImport", props);
  for (const node of nodes(tree).filter(node => node.type === "Checkbox")) node.props.onChange({ target: { checked: true } });
  tree = h.render("BunkerExistingImport", props);
  await nodes(tree).find(node => node.type === "Button" && node.props.children === "Import selected Bunkers").props.onClick();
  for (let tick = 0; tick < 8; tick++) await Promise.resolve();
  tree = h.render("BunkerExistingImport", props);
  assert.equal(added.length, 0);
  nodes(tree).find(node => node.type === "Button" && node.props.children === "Continue with imported accounts").props.onClick();
  assert.equal(added[0][0], "imported");
});
