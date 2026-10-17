import { decodeBunkerState } from "../../src/chrome/safeBunker/stateCodec";
import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, parseAbi, keccak256 } from "viem";
import { buildBunkerTransaction } from "../../src/chrome/safeBunker/transaction";
import { decodeMultiSendTransactions } from "../../src/chrome/safe/multiSend";
import { BUNKER_PINS } from "../../src/chrome/safeBunker/network";
import { broadcastBunkerBytes } from "../../src/chrome/safeBunker/broadcast";
import { normalizeBunkerIngressTransaction } from "../../src/chrome/safeBunker/ingress";
import { isSafeExecutorAccount } from "../../src/chrome/safe/accountTypePolicy";

const safe = `0x${"11".repeat(20)}` as const, owner = `0x${"22".repeat(20)}` as const;
const next = `0x${"33".repeat(20)}` as const, target = `0x${"44".repeat(20)}` as const;
const call = { to: target, value: "7" as const, data: "0x" as const, operation: 0 as const };
test("canonical CALL-only envelope preserves user order and appends exactly one owner swap", () => {
  const { transaction } = buildBunkerTransaction(safe, 81n, owner, next, [call, { ...call, value: "9" }]);
  assert.equal(transaction.to, BUNKER_PINS.multiSend.address.toLowerCase());
  assert.equal(transaction.operation, 1);
  assert.equal(transaction.nonce, 81);
  assert.equal(transaction.safeTxGas, "0"); assert.equal(transaction.baseGas, "0"); assert.equal(transaction.gasPrice, "0");
  const decoded = decodeFunctionData({ abi: parseAbi(["function multiSend(bytes transactions)"]), data: transaction.data });
  const calls = decodeMultiSendTransactions(decoded.args[0]);
  assert.deepEqual(calls.slice(0, 2), [call, { ...call, value: "9" }]);
  assert.equal(calls.length, 3); assert.equal(calls[2].to, safe); assert.equal(calls[2].operation, 0);
  const rotation = decodeFunctionData({ abi: parseAbi(["function swapOwner(address prevOwner,address oldOwner,address newOwner)"]), data: calls[2].data });
  assert.deepEqual(rotation.args.map((a) => a.toLowerCase()), ["0x0000000000000000000000000000000000000001", owner, next]);
  const recovery = buildBunkerTransaction(safe, 81n, owner, next, [], true);
  assert.equal(recovery.transaction.operation, 0); assert.equal(recovery.transaction.to, safe);
  for (const to of [safe, owner, next, BUNKER_PINS.factory.address, BUNKER_PINS.singleton.address, BUNKER_PINS.multiSend.address]) {
    assert.throws(() => buildBunkerTransaction(safe, 81n, owner, next, [{ ...call, to: to as typeof safe }]));
  }
  assert.throws(() => buildBunkerTransaction(safe, 81n, owner, next, [{ ...call, operation: 1 }]));
});
test("Bunker ingress binds chain/sender and never admits EOA authorization or creation", () => {
  const account = { id: "bunker:test", type: "safeBunker" as const, address: safe, chainId: 11155111 as const, seedVaultId: "bunker-draft:test", derivationVersion: 1 as const, createdAt: 1 };
  assert.deepEqual(normalizeBunkerIngressTransaction(account, { chainId: 11155111, from: safe, to: target, value: "0x7" }), [call]);
  for (const tx of [{ chainId: 1, to: target }, { chainId: 11155111, from: owner, to: target }, { chainId: 11155111 }, { chainId: 11155111, to: target, authorizationList: [] }]) assert.throws(() => normalizeBunkerIngressTransaction(account, tx));
  for (const type of ["bankr", "impersonator", "safe", "safeBunker"]) assert.equal(isSafeExecutorAccount({ ...account, type } as any), false);
  for (const type of ["privateKey", "seedPhrase", "ledger"]) assert.equal(isSafeExecutorAccount({ ...account, type } as any), true);
});
test("ambiguous Bunker RPC outcomes return only the deterministic hash without logging raw bytes", async () => {
  const raw = "0x1234" as const, requests: unknown[] = [], logs: unknown[] = [];
  const warn = console.warn; console.warn = (...args) => { logs.push(args); };
  try {
    const client = { request: async (request: unknown) => { requests.push(request); throw new Error(`RPC reflected ${raw}`); } };
    const result = await broadcastBunkerBytes(client as never, raw);
    assert.deepEqual(result, { txHash: keccak256(raw), broadcastUncertain: true });
    assert.deepEqual(logs, []); assert.equal(requests.length, 1);
    assert.equal(JSON.stringify(result).includes(raw), false);
  } finally { console.warn = warn; }
});

test("Bunker RPC diagnostics identify the failed step without exposing the RPC payload", async () => {
  const { bunkerStep, bunkerStepMessage } = await import("../../src/chrome/safeBunker/errors");
  for (const step of ["estimate", "fees", "simulation"] as const) {
    let failure: unknown;
    try { await bunkerStep(step, async () => { throw new Error("signed calldata 0xdeadbeef private transport URL"); }); }
    catch (error) { failure = error; }
    const message = bunkerStepMessage(failure);
    assert.ok(message?.endsWith(`[${step}]`));
    assert.doesNotMatch(message!, /deadbeef|private transport|signed calldata/);
  }
  assert.equal(bunkerStepMessage(new Error("untrusted RPC error")), null);
});

test("Bunker journals preserve optional backup confirmation and accept legacy states", () => {
  const legacy = { version: 1, id: "bunker-draft:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", accountId: "bunker:test",
    plan: { address: safe, initializer: "0x", salt: "0", fromBlock: "0" }, activated: false, archived: false,
    ownerIndex: 0, nextIndex: 1, exposureUnknown: false, usedOwners: [], defaultPayer: null, operations: [], recovery: null };
  assert.equal(decodeBunkerState(legacy).backupConfirmed, undefined);
  assert.equal(decodeBunkerState({ ...legacy, backupConfirmed: true }).backupConfirmed, true);
  assert.throws(() => decodeBunkerState({ ...legacy, backupConfirmed: "true" }));
  assert.throws(() => decodeBunkerState({ ...legacy, backupConfirmed: false }));
});

test("recovery target owner is optional for legacy journals and strictly validated", () => {
  const state = { version: 1, id: "bunker-draft:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", accountId: "bunker:test",
    plan: { address: safe, initializer: "0x", salt: "0", fromBlock: "0" }, activated: false, archived: false,
    ownerIndex: 0, nextIndex: 1, exposureUnknown: true, usedOwners: [], defaultPayer: null, operations: [],
    recovery: { scanBlock: "100", targetBlock: "200", deriveIndex: 64, matchedIndex: null, usedOwners: [] } };
  assert.equal(decodeBunkerState(state).recovery?.targetOwner, undefined);
  assert.equal(decodeBunkerState({ ...state, recovery: { ...state.recovery, targetOwner: safe } }).recovery?.targetOwner, safe);
  assert.throws(() => decodeBunkerState({ ...state, recovery: { ...state.recovery, targetOwner: "0x01" } }));
});
