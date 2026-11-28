import assert from "node:assert/strict";
import test from "node:test";
import { decodeBunkerSwapContext } from "../../src/chrome/safeBunker/swapContext";
import { decodeBunkerState } from "../../src/chrome/safeBunker/stateCodec";
import { isBunkerPayerAvailable } from "../../src/chrome/safeBunker/payerPolicy";
import type { Account } from "../../src/chrome/types";

const address = `0x${"11".repeat(20)}`;
const swapMeta = { sellTokenSymbol: "ETH", sellTokenLogo: null, buyTokenSymbol: "USDC", buyTokenLogo: null };
export const context = { slippageBps: 50,
  sell: { address: "native", name: "Ether", symbol: "ETH", decimals: 18, amount: "1000000000000000", priceUsd: 2000, logo: null },
  buy: { address, name: "USD Coin", symbol: "USDC", decimals: 6, amount: "1900000", priceUsd: 1, logo: null } };
const call = { to: address, value: "1000000000000000", data: "0x", operation: 0 };
const operation = { id: "swap", kind: "transaction", state: "queued", createdAt: 1, calls: [call], routes: [{ kind: "wallet", origin: "WalletChan", requestId: "swap" }] };
const state = { version: 2, chainId: 8453, chainName: "Base", seedGroupId: "group", id: `bunker-source:8453:${address}`, accountId: "bunker",
  plan: { address, initializer: "0x", salt: "0", fromBlock: "0" }, activated: true, archived: false,
  ownerIndex: 0, nextIndex: 1, exposureUnknown: false, usedOwners: [], defaultPayer: null, recovery: null, operations: [operation] };

test("resumable swap review is optional in old journals and preserves exact bounded inputs", () => {
  assert.equal(decodeBunkerState(state).operations[0].swapContext, undefined);
  const next = { ...state, operations: [{ ...operation, swapMeta, swapContext: context }] };
  assert.deepEqual(decodeBunkerState(next).operations[0].swapContext, context);
  assert.deepEqual(decodeBunkerSwapContext(context), context);
  for (const bad of [{ ...context, extra: true }, { ...context, slippageBps: 10001 }, { ...context, buy: { ...context.buy, amount: "0" } }, { ...context, sell: { ...context.sell, priceUsd: Infinity } }]) {
    assert.throws(() => decodeBunkerSwapContext(bad));
  }
  assert.throws(() => decodeBunkerState({ ...state, operations: [{ ...operation, swapContext: context }] }));
  assert.throws(() => decodeBunkerState({ ...next, operations: [{ ...next.operations[0], routes: [{ kind: "injected", origin: "https://example.com", requestId: "swap", tabId: 1 }] }] }));
});

test("grouped member metadata survives strict journal decoding", () => {
  const members = [
    { id: "send", calls: [call], routes: [{ kind: "wallet", origin: "Send ETH", requestId: "send" }], createdAt: 1, transferMeta: { recipient: address, amount: "0.001", symbol: "ETH", tokenLogo: null } },
    { id: "swap", calls: [call], routes: operation.routes, createdAt: 2, swapMeta, swapContext: context },
  ];
  const group = { ...operation, id: "group", calls: members.flatMap(m => m.calls), routes: members.flatMap(m => m.routes), members };
  const decoded = decodeBunkerState({ ...state, operations: [group] }).operations[0];
  assert.deepEqual(decoded.members, members);
});

test("saved gas payer falls back when removed, replaced, or no longer eligible", () => {
  const bunker = { accountId: "bunker", address };
  const saved = { id: "payer", address };
  assert.equal(isBunkerPayerAvailable(saved, bunker, []), false);
  assert.equal(isBunkerPayerAvailable(saved, bunker, [{ id: "other", address, type: "privateKey" } as Account]), false);
  assert.equal(isBunkerPayerAvailable(saved, bunker, [{ id: "payer", address: `0x${"22".repeat(20)}`, type: "privateKey" } as Account]), false);
  for (const type of ["privateKey", "seedPhrase", "ledger", "trezor", "bankr", "impersonator", "safe"] as const) {
    assert.equal(isBunkerPayerAvailable(saved, bunker, [{ id: "payer", address, type } as Account]), ["privateKey", "seedPhrase", "ledger", "trezor"].includes(type), type);
  }
  assert.equal(isBunkerPayerAvailable({ id: "bunker", address }, bunker, []), true);
});
