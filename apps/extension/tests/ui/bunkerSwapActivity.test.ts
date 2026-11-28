import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { getActivityPresentation, getActivityStatusModel } from "../../src/components/Activity/activityModel";

// Render the real row. An Exec decoder result must never overwrite an explicit swap.
for (const kind of ["swap", "send"] as const) test(`Bunker Activity renders the normal ${kind} row instead of Exec`, () => {
  const exports: any = {};
  const decoded: unknown[][] = [];
  const jsx = (type: unknown, props: any) => ({ type, props });
  const source = readFileSync(new URL("../../src/components/Activity/ActivityItem.tsx", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, Date, require(name: string) {
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (name === "@/theme") return { useTheme: () => ({ themeId: "midnight" }), useIconChipBg: () => "surface.raised", isDarkThemeId: () => true };
    if (name === "./activityModel") return { getActivityPresentation, getActivityStatusModel, formatTimeAgo: () => "Just now" };
    if (name.endsWith("useSafeProposalFunctionNames")) return { useSafeProposalFunctionNames: (_id: string, calls: unknown[]) => { decoded.push(calls); return { 0: "exec" }; } };
    if (name.endsWith("safeProposalPresentation")) return { getSafeRequestAction: () => { throw new Error("swap must bypass generic Bunker action decoding"); } };
    if (name === "./useActivityExplorers") return { useActivityExplorers: () => ({}) };
    return new Proxy({}, { get: (_target, key) => key });
  } });
  const swapMeta = { sellTokenSymbol: "ETH", sellTokenLogo: null, buyTokenSymbol: "USDC", buyTokenLogo: null };
  const tree = exports.default({ tx: { id: "swap", origin: "WalletChan", status: "success", createdAt: 1,
    chainId: 8453, chainName: "Base", tx: { from: `0x${"11".repeat(20)}` },
    ...(kind === "swap" ? { swapMeta } : { transferMeta: { recipient: `0x${"33".repeat(20)}`, amount: "1", symbol: "ETH", tokenLogo: null } }),
    safeBunkerMeta: { kind: "transaction", calls: [{ to: `0x${"22".repeat(20)}`, data: "0x12345678", value: "0", operation: 0 }] } },
    addressLabels: new Map(), resolveLogo: (url: string) => url, onClick() {} });
  assert.match(JSON.stringify(tree), kind === "swap" ? /Swap ETH → USDC/ : /Send ETH/);
  assert.equal(decoded[0].length, 0, "known swaps do not request generic calldata names");
});
