import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildSafeSwapProposalCalls } from "../../src/components/Swap/safeSwapProposal";
import { getSwapSubmissionKind } from "../../src/components/Swap/swapSubmissionModel";
import type { PreparedSwapTxEntry } from "../../src/components/Swap/swapViewTypes";

const appUrl = new URL("../../src/App.tsx", import.meta.url);
const preparedSwapUrl = new URL(
  "../../src/components/Swap/usePreparedSwap.ts",
  import.meta.url,
);

function transaction(
  overrides: Partial<PreparedSwapTxEntry["tx"]> = {},
): PreparedSwapTxEntry {
  return {
    tx: {
      from: "0x1111111111111111111111111111111111111111",
      to: "0x2222222222222222222222222222222222222222",
      data: "0xa9059cbb",
      value: "0x2a",
      chainId: 8453,
      ...overrides,
    },
    origin: "Swap USDC to ETH",
    favicon: null,
  };
}

test("swap submission keeps every wallet type on its authorized path", () => {
  for (const accountType of ["bankr", "privateKey", "seedPhrase"] as const) {
    assert.equal(
      getSwapSubmissionKind(accountType, false),
      "walletExecution",
      accountType,
    );
  }
  assert.equal(getSwapSubmissionKind("safeBunker", false), "bunkerExecution");
  assert.equal(getSwapSubmissionKind("safeBunker", true), "unsupported");
  assert.equal(getSwapSubmissionKind("safe", false), "safeProposal");
  assert.equal(getSwapSubmissionKind("safe", true), "unsupported");
  assert.equal(getSwapSubmissionKind("impersonator", false), "unsupported");
});

test("Safe swap calls preserve order and normalize values for MultiSend", () => {
  const calls = buildSafeSwapProposalCalls(
    [transaction(), transaction({ value: "0x0", data: "0x095ea7b3" })],
    8453,
  );

  assert.deepEqual(calls, [
    {
      to: "0x2222222222222222222222222222222222222222",
      value: "42",
      data: "0xa9059cbb",
      operation: 0,
    },
    {
      to: "0x2222222222222222222222222222222222222222",
      value: "0",
      data: "0x095ea7b3",
      operation: 0,
    },
  ]);
});

test("Safe swap calls reject mixed-chain plans", () => {
  assert.throws(
    () => buildSafeSwapProposalCalls([transaction({ chainId: 1 })], 8453),
    /one network/,
  );
});

test("Safe swaps create a proposal and open the shared request screen", async () => {
  const [app, preparedSwap] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(preparedSwapUrl, "utf8"),
  ]);

  assert.doesNotMatch(app, /Safe swaps are not available yet/);
  assert.match(app, /onSafeProposalCreated=\{\(proposalId\) => \{/);
  assert.match(app, /openSafeApprovals\(proposalId\)/);
  assert.match(app, /useSafeRequestNavigation\(/);
  assert.match(preparedSwap, /createSafeSwapProposal\(\{/);
  assert.match(preparedSwap, /options\.onSafeProposalCreated\(proposalId\)/);
  assert.match(preparedSwap, /executePreparedSwap\(\{/);
});

test("Bunker staging sends only account-bound unsigned calls through its own route", async () => {
  const { createBunkerSwapRequest } = await import("../../src/components/Swap/safeSwapProposal");
  const previous = (globalThis as any).chrome;
  const messages: any[] = [];
  (globalThis as any).chrome = { runtime: { sendMessage: async (message: unknown) => {
    messages.push(message); return { success: true, result: { id: "swap-review" } };
  } } };
  try {
    assert.equal(await createBunkerSwapRequest({ safeAccountId: "bunker", chainId: 8453, transactions: [transaction()] }, "swap-review"), "swap-review");
    assert.deepEqual(messages, [{ type: "createSafeBunkerRequest", accountId: "bunker", chainId: 8453,
      id: "swap-review", calls: buildSafeSwapProposalCalls([transaction()], 8453) }]);
    await assert.rejects(createBunkerSwapRequest({ safeAccountId: "bunker", chainId: 1, transactions: [transaction()] }, "bad"), /one network/);
    assert.equal(messages.length, 1);
    const swapMeta = { sellTokenSymbol: "ETH", sellTokenLogo: null, buyTokenSymbol: "USDC", buyTokenLogo: null };
    await createBunkerSwapRequest({ safeAccountId: "bunker", chainId: 8453, transactions: [{ ...transaction(), swapMeta }] }, "with-metadata");
    assert.deepEqual(messages[1].swapMeta, swapMeta);
  } finally { (globalThis as any).chrome = previous; }
});
