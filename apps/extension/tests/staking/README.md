# WCHAN staking tests

These tests mirror `src/chrome/staking/` and freeze its privileged read
boundary:

- `architecture.test.ts` verifies the stable facade preserves the focused
  implementation identities, malformed owner/preview inputs fail before RPC,
  and remote APY values remain finite and bounded.

Transaction planning and all wallet-type batching choices are covered in
`tests/ui/stakingModel.test.ts`. Reset-barrier routing, Ledger device rebinding,
and the impersonator submission block are covered by the background and
transaction architecture suites.

`bunkerController.test.ts` runs the real preparation hook with deterministic
React slots: Bunker approval/deposit stages one shared intent, double-clicks are
claimed synchronously, non-Base requests are blocked, and existing EOA/view-only
routing is preserved. Device acceptance remains manual.
