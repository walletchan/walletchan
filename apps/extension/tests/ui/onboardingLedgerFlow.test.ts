import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (path: string) =>
  readFile(new URL(`../../src/${path}`, import.meta.url), "utf8");

test("onboarding groups Ledger and Bankr under Connect before the import choices", async () => {
  const source = await readSource("pages/onboarding/AccountTypeStep.tsx");
  const viewOnly = source.indexOf('title: "View-only"');
  const ledger = source.indexOf('title: "Ledger"');
  const bankr = source.indexOf('title: "Bankr API"');

  assert.ok(ledger >= 0 && bankr > ledger && viewOnly > bankr);
  assert.match(source, /"hid" in navigator/);
  assert.match(source, /"offscreen" in chrome/);
  assert.match(source, /LedgerLogo variant="lettermark"/);
});

test("Ledger onboarding defers persistence until after master credential setup", async () => {
  const submission = await readSource(
    "pages/onboarding/onboardingSubmission.ts",
  );
  const ledgerCommit = submission.indexOf(
    'else if (input.accountType === "ledger")',
  );
  const credential = submission.indexOf(
    'await initializeCredential("pk-only-mode")',
    ledgerCommit,
  );
  const accountWrite = submission.indexOf(
    'type: "addLedgerAccounts"',
    ledgerCommit,
  );

  assert.ok(ledgerCommit >= 0 && credential > ledgerCommit);
  assert.ok(accountWrite > credential);
  assert.match(submission, /type: "rollbackOnboardingInitialization"/);
});

test("Trezor onboarding defers persistence until after master credential setup", async () => {
  const submission = await readSource(
    "pages/onboarding/onboardingSubmission.ts",
  );
  const trezorCommit = submission.indexOf(
    'type: "addTrezorAccounts"',
  );
  const credential = submission.lastIndexOf(
    'await initializeCredential("pk-only-mode")',
    trezorCommit,
  );
  assert.ok(trezorCommit >= 0 && credential >= 0 && credential < trezorCommit);
  assert.match(submission, /type: "rollbackOnboardingInitialization"/);
});

test("the shared Ledger flow can collect without writing accounts early", async () => {
  const [ledgerFlow, sharedFlow] = await Promise.all([
    readSource("components/Ledger/AddLedgerFlow.tsx"),
    readSource("components/HardwareWallet/AddHardwareWalletFlow.tsx"),
  ]);

  assert.match(
    ledgerFlow,
    /commitAccounts\?\(selection: LedgerAccountSelection\)/,
  );
  assert.match(
    ledgerFlow,
    /renderLayout\?\(parts: LedgerFlowLayoutParts\)/,
  );
  assert.match(sharedFlow, /if \(commitAccounts\) \{/);
  assert.match(sharedFlow, /await commitAccounts\(selection\)/);
});
