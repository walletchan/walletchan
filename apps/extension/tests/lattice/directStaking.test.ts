/** Twin of the Ledger checks in tests/transactions/impersonatedSwapArchitecture.test.ts. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file: string) => readFile(new URL(`../../src/${file}`, import.meta.url), "utf8");

test("direct staking routes Lattice accounts to their own executor, beside Ledger", async () => {
  const direct = await read("chrome/transactions/swaps/direct.ts");
  assert.match(direct, /account\.type === "ledger"[\s\S]*?executeLedgerSwap[\s\S]*?account\.type === "lattice"[\s\S]*?executeLatticeSwap/u);
});

test("Lattice direct execution rechecks the pinned device before every broadcast", async () => {
  const source = await read("chrome/lattice/directSwap.ts");
  assert.match(source, /ensureLatticeSigningSession/u);
  assert.match(source, /getAccountById\(account\.id\)/u);
  assert.match(source, /latest\.type !== "lattice"/u);
  assert.match(source, /latest\.deviceId !== account\.deviceId/u);
  assert.match(source, /latest\.hdPath !== account\.hdPath/u);
  assert.match(source, /signAndBroadcastLatticeTransaction/u);
  assert.match(source, /accountType: "lattice"/u);
});

test("the staking screens treat Lattice like Ledger", async () => {
  const screen = await read("components/Staking/StakingScreen.tsx");
  assert.doesNotMatch(screen, /unavailable for Lattice/u);
  assert.match(screen, /reviewed on your Lattice and broadcast in order/u);
  assert.match(screen, /const isTrezor = props\.accountType === "trezor";/u);
  const review = await read("components/Staking/StakingReviewScreen.tsx");
  assert.match(review, /props\.accountType === "ledger" \|\| props\.accountType === "lattice"/u);
});
