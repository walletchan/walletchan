import assert from "node:assert/strict";
import test from "node:test";
import { decodeBunkerSwapMetadata } from "../../src/chrome/safeBunker/swapMetadata";
import { decodeBunkerState } from "../../src/chrome/safeBunker/stateCodec";

const swapMeta = { sellTokenSymbol: "ETH", sellTokenLogo: null, buyTokenSymbol: "USDC", buyTokenLogo: null };
const address = `0x${"11".repeat(20)}`;
const state = { version: 2, chainId: 8453, chainName: "Base", seedGroupId: "group", id: `bunker-source:8453:${address}`, accountId: "bunker",
  plan: { address, initializer: "0x", salt: "0", fromBlock: "0" }, activated: true, archived: false,
  ownerIndex: 0, nextIndex: 1, exposureUnknown: false, usedOwners: [], defaultPayer: null, recovery: null,
  operations: [{ id: "swap", kind: "transaction", state: "queued", createdAt: 1, calls: [{ to: address, value: "0", data: "0x", operation: 0 }],
    routes: [{ kind: "wallet", origin: "WalletChan", requestId: "swap" }] }] };

test("swap metadata is optional for old journals and survives new journal decoding", () => {
  assert.equal(decodeBunkerState(state).operations[0].swapMeta, undefined);
  const newer = { ...state, operations: [{ ...state.operations[0], swapMeta }] };
  assert.deepEqual(decodeBunkerState(newer).operations[0].swapMeta, swapMeta);
  assert.deepEqual(decodeBunkerSwapMetadata(swapMeta), swapMeta);
});

test("unknown fields, oversized labels and external swap provenance fail closed", () => {
  for (const value of [null, { ...swapMeta, calls: [] }, { ...swapMeta, sellTokenSymbol: "x".repeat(65) }, { ...swapMeta, sellTokenSymbol: "ETH\nUSDC" }, { ...swapMeta, sellTokenLogo: "x".repeat(2049) }]) {
    assert.throws(() => decodeBunkerSwapMetadata(value));
  }
  assert.throws(() => decodeBunkerState({ ...state, operations: [{ ...state.operations[0], swapMeta,
    routes: [{ kind: "injected", origin: "https://example.com", requestId: "swap", tabId: 1 }] }] }), /provenance/);
});
