import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Render the real confirmation with deterministic hook slots. Network/effect
// scheduling is omitted: these regressions concern hydration on prop refresh.
function harness() {
  const slots: any[] = [];
  let cursor = 0;
  const hooks = {
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (value: any) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(initial: unknown) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useEffect() {},
  };
  const jsx = (type: unknown, props: any) => ({ type, props });
  const exports: any = {};
  const source = readFileSync(new URL("../../src/components/SafeBunker/BunkerTransactionConfirmation.tsx", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports, URL, Date,
    require(name: string) {
      if (name === "react") return hooks;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "@/theme") return { useTheme: () => ({ tokens: { borders: { medium: "1px solid" } } }), useStripTokens: () => ({}), useIconChipBg: () => "surface.raised" };
      if (name === "@/constants/chainRegistry") return { CHAIN_REGISTRY: [] };
      if (name === "./requestQueue") return { earlierBunkerRequest: () => null, isUnsignedBunkerRequest: () => true };
      return new Proxy({}, { get: (_target, key) => key });
    },
  });
  const operation = { id: "request", state: "queued", kind: "transaction", calls: [], origins: [] };
  function find(node: any, type: string): any {
    if (!node || typeof node !== "object") return undefined;
    if (node.type === type) return node.props;
    for (const child of [node.props?.children].flat()) {
      const result = find(child, type); if (result) return result;
    }
  }
  return (defaultId?: string, operationPayerId?: string) => {
    cursor = 0;
    const tree = exports.BunkerTransactionConfirmation({
      account: { id: "bunker" }, view: { chainId: 84532, operations: [], defaultPayer: defaultId ? { id: defaultId } : null },
      operation: { ...operation, payerId: operationPayerId }, queue: [operation],
    });
    return find(tree.props.actionSummary, "PayerFields");
  };
}

test("a saved default arriving after mount fills the Bunker gas payer", () => {
  const render = harness();
  assert.equal(render().value, "");
  assert.equal(render("saved-payer").value, "saved-payer");
  assert.equal(render("updated-default").value, "updated-default");
});

test("refreshed defaults preserve a deliberate payer selection and remember choice", () => {
  const render = harness();
  render("saved-payer").onChange("chosen-payer");
  render("saved-payer").onRemember(true);
  const refreshed = render("another-default");
  assert.equal(refreshed.value, "chosen-payer");
  assert.equal(refreshed.remember, true);
});

test("an existing operation's payer takes priority over the saved default", () => {
  const render = harness();
  assert.equal(render("saved-payer", "reviewed-payer").value, "reviewed-payer");
  assert.equal(render("changed-default", "reviewed-payer").value, "reviewed-payer");
});
