import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as model from "../../src/components/Staking/model/stakingModel";
import { buildSafeSwapProposalCalls } from "../../src/components/Swap/safeSwapProposal";
import { STAKING_CHAIN_ID } from "../../src/components/Staking/constants";

function harness(accountType = "safeBunker", bunkerChainId = STAKING_CHAIN_ID) {
  let cursor = 0;
  const slots: any[] = [], messages: any[] = [];
  let release: ((value: any) => void) | undefined;
  const exports: any = {};
  const source = readFileSync(new URL("../../src/components/Staking/hooks/useStakingController.ts", import.meta.url), "utf8");
  const input = { accountType, bunkerChainId, accountId: "account", owner: `0x${"11".repeat(20)}`, state: { allowance: 0n }, onTransactionInitiated() {} };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, crypto: { randomUUID: () => "staking-request" }, chrome: { runtime: { sendMessage: (message: any, callback?: (value: any) => void) => {
      messages.push(message);
      if (callback) { callback({ success: true }); return; }
      return new Promise(resolve => { release = resolve; });
    } } }, require(name: string) {
      if (name === "react") return {
        useState(initial: any) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], (value: any) => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
        useRef(initial: any) { const i = cursor++; return slots[i] ??= { current: initial }; }, useEffect() {}, useCallback: (value: any) => value,
      };
      if (name.endsWith("stakingModel")) return model;
      if (name.endsWith("safeSwapProposal")) return { buildSafeSwapProposalCalls };
      if (name.endsWith("constants")) return { STAKING_CHAIN_ID, STAKING_CHAIN_NAME: "Base" };
      if (name.endsWith("useThemedToast")) return { useThemedToast: () => () => {} };
      if (name.endsWith("batchTxHandlers")) return { encodeBatchCalls: () => ({ to: input.owner, data: "0x", value: "0" }) };
      throw new Error(name);
    },
  });
  return { render() { cursor = 0; return exports.useStakingController(input); }, messages, release() { release!({ success: true }); } };
}

test("Bunker staking queues one atomic intent despite double click and never calls an EOA executor", async () => {
  const h = harness(); const controller = h.render();
  const first = controller.prepare("stake", 100n);
  await controller.prepare("stake", 100n);
  assert.equal(h.messages.length, 1);
  assert.equal(h.messages[0].type, "createSafeBunkerRequest");
  assert.equal(h.messages[0].calls.length, 2, "approval and deposit share the Bunker owner rotation");
  h.release(); await first;
  assert.equal(h.render().plan.bunkerRequestId, "staking-request");
  await h.render().confirm();
  assert.equal(h.messages.length, 1);
});

test("a Bunker on another chain cannot prepare Base staking", async () => {
  const h = harness("safeBunker", 1); await h.render().prepare("claim", 0n);
  assert.equal(h.messages.length, 0); assert.equal(h.render().plan, null);
});

for (const accountType of ["privateKey", "seedPhrase", "ledger", "trezor", "bankr", "impersonator"]) {
  test(`${accountType} keeps its existing staking submission policy`, async () => {
    const h = harness(accountType); await h.render().prepare("stake", 100n); await h.render().confirm();
    assert.equal(h.messages.some(message => message.type === "createSafeBunkerRequest"), false);
    assert.equal(h.messages.length, accountType === "impersonator" ? 0 : 1);
  });
}
