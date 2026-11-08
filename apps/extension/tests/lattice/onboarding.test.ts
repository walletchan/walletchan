/** Twin of tests/ui/onboardingLedgerFlow.test.ts for the Lattice first-account step. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (path: string) => readFile(new URL(`../../src/${path}`, import.meta.url), "utf8");

test("onboarding offers Lattice under Connect, after Ledger, with no USB availability gate", async () => {
  const source = await readSource("pages/onboarding/AccountTypeStep.tsx");
  const ledger = source.indexOf('title: "Ledger"');
  const lattice = source.indexOf('title: "Lattice"');
  const bankr = source.indexOf('title: "Bankr API"');
  assert.ok(ledger >= 0 && lattice > ledger && bankr > lattice);
  assert.match(source, /title: "Lattice", type: "lattice", group: "Connect"/);
  assert.match(source, /LatticeLogo variant="lettermark"/);
  // The filters gate only Ledger (WebHID) and Trezor; Lattice talks over HTTPS.
  assert.doesNotMatch(source, /option\.type !== "lattice"/);
  const types = await readSource("pages/onboarding/onboardingTypes.ts");
  assert.match(types, /lattice: "lattice"/);
});

test("Lattice onboarding defers persistence until after master credential setup", async () => {
  const submission = await readSource("pages/onboarding/onboardingSubmission.ts");
  const latticeCommit = submission.indexOf('else if (input.accountType === "lattice")');
  const credential = submission.indexOf('await initializeCredential("pk-only-mode")', latticeCommit);
  const accountWrite = submission.indexOf('type: "addLatticeAccounts"', latticeCommit);
  assert.ok(latticeCommit >= 0 && credential > latticeCommit);
  assert.ok(accountWrite > credential);
  assert.match(submission, /Connect your Lattice and select at least one account/);
});

test("the Lattice step collects without writing accounts early", async () => {
  const [step, flow] = await Promise.all([
    readSource("pages/onboarding/LatticeOnboardingStep.tsx"),
    readSource("components/Lattice/AddLatticeFlow.tsx"),
  ]);
  assert.match(step, /<AddLatticeFlow[\s\S]*commitAccounts=\{onCollect\}/);
  assert.match(flow, /commitAccounts\?\(selection: HardwareWalletAccountSelection\)/);
  assert.match(flow, /commitAccounts=\{commitAccounts\}/);
});
