import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as model from "../../src/components/SafeBunker/discoveryModel";

test("found Bunkers do not become saved-account indicators until added", async () => {
  const slots: any[] = [], effects: Array<{ deps: unknown[]; cleanup?: () => void }> = [];
  let cursor = 0, accounts: any[] = [], group: string | undefined = "seed";
  const hooks = {
    useState(initial: unknown) {
      const i = cursor++; if (!(i in slots)) slots[i] = initial;
      return [slots[i], (next: any) => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }];
    },
    useRef(initial: unknown) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useCallback(fn: unknown) { return fn; },
    useEffect(fn: () => (() => void), deps: unknown[]) {
      const i = cursor++, old = effects[i];
      if (!old || deps.some((value, n) => !Object.is(value, old.deps[n]))) {
        old?.cleanup?.(); effects[i] = { deps, cleanup: fn() };
      }
    },
  };
  const exports: any = {};
  const source = readFileSync(new URL("../../src/components/SafeBunker/useBunkerDiscovery.ts", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, setTimeout,
    chrome: { runtime: { onMessage: { addListener() {}, removeListener() {} }, sendMessage: async ({ type }: any) =>
      type === "getAccounts" ? accounts : [{ id: "seed", name: "Seed #2" }] } },
    require: (name: string) => {
      if (name === "react") return hooks;
      if (name === "./discoveryModel") return model;
      if (name === "./transport") return { bunkerCommand: async ({ type }: any) => type === "getSafeBunkerNetworks"
        ? { networks: [{ chainId: 84532, name: "Base Sepolia" }] } : { discovery: { chainId: 84532, status: "deployed", address: "0x1234" } } };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  const render = () => { cursor = 0; return exports.useBunkerDiscovery(group); };
  const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); return render(); };
  render(); let state = await settle();
  await state.find(); state = render();
  assert.equal(state.results.seed[84532].status, "deployed");
  assert.equal(state.localResults.seed, undefined);
  group = undefined; render(); state = await settle();
  assert.equal(state.localResults.seed, undefined, "back to saved seeds shows no chain logo");
  accounts = [{ id: "bunker", type: "safeBunker", seedGroupId: "seed", chainId: 84532, address: "0x1234" }];
  state.refresh(); render(); state = await settle();
  assert.equal(state.localResults.seed[84532].status, "local", "indicator appears after adding the account");
  accounts = []; state.refresh(); render(); state = await settle();
  assert.equal(state.localResults.seed, undefined, "removal clears the stored-account indicator");
});
