import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { buildTransferTx } from "../../src/chrome/transferUtils";

async function submit(accountType: string, tokenAmount = "1", canSubmit = true) {
  const messages: any[] = [], exports: any = {};
  const source = readFileSync(new URL("../../src/components/Transfer/hooks/useTransferSubmission.ts", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, chrome: { runtime: { sendMessage(message: any, callback: (value: any) => void) { messages.push(message); callback({ success: true }); } } },
    require(name: string) {
      if (name === "react") return { useState: (initial: any) => [initial, () => {}] };
      if (name.endsWith("transferUtils")) return { buildTransferTx };
      if (name.endsWith("useThemedToast")) return { useThemedToast: () => () => {} };
      throw new Error(name);
    },
  });
  const controller = exports.useTransferSubmission({
    token: { contractAddress: "native", decimals: 18, chainId: 8453, symbol: "ETH", logoUrl: null },
    accountType, tokenAmount, isMaxSelected: true, isNativeToken: true, trimmedHexData: "0x12345678",
    fromAddress: `0x${"11".repeat(20)}`, resolvedAddress: `0x${"22".repeat(20)}`, chainName: "Base",
    isContractDeployment: false, sponsored: { isSponsoredFlow: false }, recipientSafetyPasses: true, onTransferInitiated() {},
  });
  await controller.submit(canSubmit); return messages;
}

test("native Bunker MAX with calldata reaches the shared bounded review without changing calldata", async () => {
  const [message] = await submit("safeBunker");
  assert.equal(message.nativeMax, true);
  assert.equal(message.tx.data, "0x12345678");
  assert.equal(BigInt(message.tx.value), 10n ** 18n);
  const [zero] = await submit("safeBunker", "0");
  assert.equal(zero.nativeMax, undefined, "zero-value calls need no positive value cap");
  assert.equal(BigInt(zero.tx.value), 0n);
});
for (const type of ["privateKey", "seedPhrase", "ledger", "trezor", "bankr", "safe"]) {
  test(`${type} keeps its existing transfer request without Bunker MAX fields`, async () => {
    const [message] = await submit(type); assert.equal(message.nativeMax, undefined);
  });
}
test("a view-only Send stays blocked by the existing canSubmit gate", async () => {
  assert.equal((await submit("impersonator", "1", false)).length, 0);
});
