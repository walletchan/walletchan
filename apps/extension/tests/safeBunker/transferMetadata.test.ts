import assert from "node:assert/strict";
import test from "node:test";
import { encodeFunctionData, erc20Abi } from "viem";
import { assertBunkerNativeMax, buildBunkerTransferMetadata, bunkerNativeMaxAmount, decodeBunkerTransferMetadata } from "../../src/chrome/safeBunker/transferMetadata";
import type { SafeCall } from "../../src/chrome/safe/types";
import { decodeBunkerState } from "../../src/chrome/safeBunker/stateCodec";

const recipient = `0x${"11".repeat(20)}` as const;
const token = `0x${"22".repeat(20)}` as const;
const native: SafeCall[] = [{ to: recipient, value: "1000000000000000000", data: "0x", operation: 0 }];
const meta = { recipient, amount: "1", symbol: "ETH", tokenLogo: null };

test("internal Send derives native and ERC20 Activity details from actual calls", async () => {
  assert.deepEqual(await buildBunkerTransferMetadata(8453, native, null, async () => ({ name: "Ether", symbol: "ETH", decimals: 18 })), meta);
  const calls: SafeCall[] = [{ to: token, value: "0", operation: 0, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [recipient, 1250000n] }) }];
  assert.deepEqual(await buildBunkerTransferMetadata(8453, calls, null, async (address, chain) => {
    assert.equal(address, token); assert.equal(chain, 8453);
    return { name: "USD Coin", symbol: "USDC", decimals: 6 };
  }), { recipient, amount: "1.25", symbol: "USDC", tokenLogo: null });
  assert.equal(await buildBunkerTransferMetadata(8453, [{ ...native[0], data: "0x12345678" }]), undefined);
  assert.equal(await buildBunkerTransferMetadata(8453, native, null, async () => null), undefined);
});

test("transfer metadata stays bound to its recipient and native amount", () => {
  assert.deepEqual(decodeBunkerTransferMetadata(meta, native), meta);
  for (const value of [{ ...meta, recipient: token }, { ...meta, amount: "2" }, { ...meta, extra: true }, { ...meta, symbol: "ETH\n" }]) {
    assert.throws(() => decodeBunkerTransferMetadata(value, native));
  }
});

test("native MAX intent is bounded, native CALL and survives optional journal decoding", () => {
  const nativeMax = { limit: native[0].value };
  assert.doesNotThrow(() => assertBunkerNativeMax(nativeMax, native));
  for (const invalid of [{ limit: "0" }, { limit: "01" }, { limit: "1", extra: true }, { limit: (2n ** 256n).toString() }]) assert.throws(() => assertBunkerNativeMax(invalid, native));
  assert.doesNotThrow(() => assertBunkerNativeMax(nativeMax, [{ ...native[0], data: "0x12345678" }]));
  assert.throws(() => assertBunkerNativeMax(nativeMax, [{ ...native[0], operation: 1 }]));
  const state = { version: 2, chainId: 8453, chainName: "Base", seedGroupId: "group", id: `bunker-source:8453:${recipient}`, accountId: "bunker",
    plan: { address: recipient, initializer: "0x", salt: "0", fromBlock: "0" }, activated: true, archived: false,
    ownerIndex: 0, nextIndex: 1, exposureUnknown: false, usedOwners: [], defaultPayer: null, recovery: null,
    operations: [{ id: "send", kind: "transaction", state: "queued", createdAt: 1, calls: native,
      routes: [{ kind: "wallet", origin: "Send ETH", requestId: "send" }], transferMeta: meta, nativeMax }] };
  assert.deepEqual(decodeBunkerState(state).operations[0].transferMeta, meta);
  assert.deepEqual(decodeBunkerState(state).operations[0].nativeMax, nativeMax);
  assert.throws(() => decodeBunkerState({ ...state, operations: [{ ...state.operations[0], routes: [{ kind: "injected", origin: "https://example.com", requestId: "send", tabId: 1 }] }] }), /provenance/);
});

test("MAX reserves prefund shortfall with headroom, honors deposits and never exceeds the chosen limit", () => {
  assert.deepEqual(bunkerNativeMaxAmount(1000n, 1000n, 0n, 100n), { amount: 890n, reserve: 110n });
  assert.equal(bunkerNativeMaxAmount(1000n, 1000n, 100n, 100n).amount, 1000n);
  assert.equal(bunkerNativeMaxAmount(2000n, 1000n, 0n, 100n).amount, 1000n);
  assert.equal(bunkerNativeMaxAmount(1000n, 1000n, 40n, 100n).amount, 934n);
  assert.equal(bunkerNativeMaxAmount(1000n, 1000n, 0n, 90n, 120n).amount, 880n);
  assert.equal(bunkerNativeMaxAmount(100n, 100n, 0n, 100n).amount, 0n);
});
