import assert from "node:assert/strict";
import test from "node:test";
import { zeroAddress } from "viem";
import { preflightBunkerExecution } from "../../src/chrome/safeBunker/preflight";
import { configurationEpoch, SAFE_SINGLETON_SLOT, GUARD_STORAGE_SLOT } from "../../src/chrome/safe/onchainState";
import { BUNKER_PINS } from "../../src/chrome/safeBunker/network";

const safe = `0x${"11".repeat(20)}` as const, owner = `0x${"22".repeat(20)}` as const, next = `0x${"33".repeat(20)}` as const;
const singleton = BUNKER_PINS.singleton.address.toLowerCase() as typeof safe;
function fixture(change: Record<string, unknown> = {}) {
  const values: Record<string, any> = { chainId: 11155111, VERSION: "1.4.1", getOwners: [owner], getThreshold: 1n, nonce: 7n,
    getModulesPaginated: [[], "0x0000000000000000000000000000000000000001"], guard: zeroAddress, fallback: zeroAddress, singleton,
    code: "0x", count: 0, balance: 1000000n, ...change };
  const reads: { method: string; input: any }[] = [];
  const record = (method: string, input: any) => { reads.push({ method, input }); };
  const client = {
    getBlockNumber: async () => 100n,
    getChainId: async () => values.chainId,
    readContract: async (input: any) => { record("contract", input); return values[input.functionName]; },
    getStorageAt: async (input: any) => { record("storage", input); return input.slot === SAFE_SINGLETON_SLOT ? values.singleton : input.slot === GUARD_STORAGE_SLOT ? values.guard : values.fallback; },
    getCode: async (input: any) => { record("code", input); return values.code; },
    getTransactionCount: async (input: any) => { record("count", input); return values.count; },
    getBalance: async (input: any) => { record("balance", input); return values.balance; },
    call: async (input: any) => { record("call", input); if (values.revert) throw new Error("untrusted RPC private payload"); return { data: "0x" }; },
  };
  const review = { nonce: 7, payerAddress: next, maxFee: "1000", gas: { gasLimit: "80000" }, configEpoch: configurationEpoch({
    chainId: 11155111, safeAddress: safe, singleton, version: "1.4.1", owners: [owner], contractOwners: [], threshold: 1, modules: [], guard: zeroAddress, fallbackHandler: zeroAddress,
  }) };
  return { run: () => preflightBunkerExecution({ chainId: 11155111, plan: { address: safe } } as never, review as never, owner, next, "0x1234", client as never), reads };
}

test("one preflight pins all mutable reads and the gas-capped exact simulation to one block", async () => {
  const { run, reads } = fixture();
  assert.equal(await run(), 100n);
  assert.equal(reads.filter(r => r.method === "call").length, 1);
  assert.equal(reads.filter(r => r.method === "call")[0].input.gas, 80000n);
  assert.ok(reads.every(r => r.input.blockNumber === 100n));
});

for (const [name, change, error] of [
  ["wrong chain", { chainId: 1 }, /chain mismatch/],
  ["owner changed", { getOwners: [next] }, /owner or nonce changed/],
  ["nonce changed", { nonce: 8n }, /owner or nonce changed/],
  ["threshold changed", { getThreshold: 2n }, /configuration changed/],
  ["guard added", { guard: next }, /configuration changed/],
  ["fallback changed", { fallback: next }, /configuration changed/],
  ["singleton changed", { singleton: next }, /configuration changed/],
  ["module added", { getModulesPaginated: [[next], next] }, /configuration changed/],
  ["owner delegated", { code: "0xef0100" }, /plain addresses/],
  ["owner used", { count: 1 }, /transaction sender/],
  ["payer balance changed", { balance: 1n }, /insufficient/],
  ["gas-capped simulation fails", { revert: true }, /could not be simulated/],
] as const) test(`preflight rejects ${name}`, async () => { await assert.rejects(fixture(change).run(), error); });
