# Transaction history tests

These tests mirror `src/chrome/history/`:

- `architecture.test.ts` protects compatibility-facade identities, one-way
  dependencies, root clutter, and per-module audit budgets.
- `repository.test.ts` protects the released `txHistory` key and shape,
  newest-first 50-entry cap, serialized updates, notifications, stale-entry
  policy, and case-insensitive per-account cleanup.
- `assetExtraction.test.ts` protects fungible Transfer-log filtering, numeric
  coercion, the narrow ERC-5792 receipt projection, and backfill eligibility.
- `sendRecipient.test.ts` covers native/token/sponsored payee capture for all
  four signers, history compaction, conservative legacy backfill, success-only
  comparison references, excluded logs/approvals/impersonators, and deletion.

RPC retry timing and upstream token metadata are intentionally kept behind the
domain boundaries; tests here focus on deterministic policy and persistence.

`signatureHistory.test.ts` exercises additive v2→v4 upgrade preservation, actual
vault encryption/decryption and identity binding, duplicate suppression, filters,
explicit transaction/Safe exports without signatures/calldata, byte retention,
per-account clear, reset and session invalidation.

Temporary conversion coverage validates all five signer types, mixed old/current
rows, repeated calls, corrupt-row rollback and session invalidation.
