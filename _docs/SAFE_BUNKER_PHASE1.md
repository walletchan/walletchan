# Safe Bunker Phase 1: local draft foundation

Implemented locally on `codex/safe-bunker-new`, 2026-10-16. No commit, push,
contract deployment or funded transaction was performed.

## Delivered

- Add account → Safe Bunker → named local Sepolia draft creation and saved list.
- Dedicated background-generated 12-word seed, per-draft AES-256-GCM DEK and
  general-vault-key wrapper. Identity/purpose-bound AAD and strict bounded codecs.
- Frozen fully hardened `m/44'/60'/0'/0'/n'` public-owner derivation, independently
  compared with ethers including index 256 and the maximum hardened index.
- Master-authorized phrase reveal through the existing screen, with wrong-password,
  agent, lock and late-response protections. Individual owner keys stay internal.
- Idempotent draft IDs and retained retry inputs; storage failure never reports
  a successful draft, and repeated requests cannot create multiple seeds/entries.
- Hydration/master-recovery integrity checks, password/passkey/agent-factor
  compatibility, reset manifest and fresh-onboarding identity preservation.
- Explicit `safeBunker` AccountType policies denying generic signing, Safe owner,
  payer and force-inclusion capabilities. Its deployed metadata interface is
  reserved; it does not enter the active Account union until Phase 2 activation.

No address is displayed for receiving funds. Drafts never populate `accounts`,
`pkVault`, `seedGroups` or `mnemonicVault`, and they cannot connect/sign/send.
No relay, refund logic, Merkle commitment or custom contract is introduced.

## Validation

| Check | Result |
| --- | --- |
| Account/Safe/signature/request/WC/background/reset + initial Bunker regressions | 359 passed |
| Password/passkey/session/auth suite, final run | 195 passed |
| Transactions/Ledger no-device + expanded Bunker tests | 122 passed |
| UI architecture/model/size guardrails | 450 passed |
| Full extension source typecheck | Passed |
| QA script typecheck | Passed |
| Scoped source ESLint, zero warnings | Passed |
| Full extension build, all manifest targets and artifact budgets, final run | Passed |
| Built MV3 draft/seed/auth/reload/idempotency QA | Passed |
| Both themes at 320 / 420 / 1280px widths | Six states passed overflow and serious/critical axe checks |

The first auth run detected a race-test ordering change caused by unnecessary
metadata reads in the empty-draft integrity path. The empty path now returns
before those reads; the complete auth suite subsequently passed. No guardrail
was weakened or timeout extended. Older worktree baseline failures are not
assumed to apply to this checkout.

The expanded Bunker tests exercise passkey cryptographic setup/unlock/removal
using synthetic PRF material, including preservation of the factor when draft
integrity fails. This is not a physical WebAuthn ceremony. Ledger automated
regressions passed; no real Ledger device was exercised. Phase 1 adds no Ledger
signing path or transaction flow.

## Reproduce

From the repository root:

```sh
pnpm test:extension-passkey
pnpm test:extension-ui
pnpm typecheck:extension
pnpm typecheck:extension:qa
pnpm build:extension
```

From `apps/extension`:

```sh
pnpm exec tsx --test tests/safeBunker/*.test.ts
pnpm exec tsx scripts/bunker-foundation-qa.ts
```

The browser script uses a disposable Chromium profile and synthetic onboarding
account, never the user's browser profile. It verifies creation without an active
Bunker account, wrong-password rejection, 12-word display, hidden phrase rendering,
reload persistence, exact idempotent retry and agent blocking. It closes its browser
and deletes its profile. It does not log or screenshot recovery words. Screenshots
and a public-only result report are written to `/tmp/bunker-foundation-qa/`.

For manual inspection, load the fresh unpacked extension from:
`/Users/apoorvlathey/.codex/worktrees/safe-bunker-new/walletchan/apps/extension/build/`.
Open Choose account → Add account → Safe Bunker. This is local draft setup only;
deployment and transactions are not available.

## Next boundary

Phase 2 adds standard Safe address planning, deployment, verified activation and
existing-wallet gas-payer selection/defaults. It needs its own user instruction.
Do not promote a hidden owner address to an active wallet address or copy the
old reference's custom contracts/service registry to bridge that gap.
