import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function harness() {
  let price: any = null, chain: number | undefined, cleanup: (() => void) | undefined;
  const callbacks: ((value: any) => void)[] = [], exports: any = {};
  const source = readFileSync(new URL("../../src/components/SafeBunker/useNativePriceUsd.ts", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, chrome: { runtime: { sendMessage(message: any, callback: (value: any) => void) { assert.equal(message.type, "fetchNativePrice"); callbacks.push(callback); } } },
    require() { return {
      useState: () => [price, (value: any) => { price = value; }],
      useEffect(effect: () => () => void, deps: number[]) { if (deps[0] !== chain) { cleanup?.(); chain = deps[0]; cleanup = effect(); } },
    }; },
  });
  return { callbacks, render: (id: number) => exports.useNativePriceUsd(id) };
}

test("native fee fiat accepts a positive quote and discards late responses after chain changes", () => {
  const h = harness(); assert.equal(h.render(1), null);
  h.callbacks[0]({ success: true, priceUsd: 2000 }); assert.equal(h.render(1), 2000);
  assert.equal(h.render(8453), null);
  h.callbacks[0]({ success: true, priceUsd: 9999 }); assert.equal(h.render(8453), null);
  h.callbacks[1]({ success: true, priceUsd: 2100 }); assert.equal(h.render(8453), 2100);
});

test("unavailable or invalid fiat prices stay omitted", () => {
  for (const response of [{ success: false }, { success: true, priceUsd: 0 }, { success: true, priceUsd: Infinity }, { success: true, priceUsd: "invalid" }]) {
    const h = harness(); h.render(1); h.callbacks[0](response); assert.equal(h.render(1), null);
  }
});
