# Safe Bunker tests

`foundation.test.ts` covers hardened derivation against ethers, seed/journal crypto,
strict storage and master/agent/factor boundaries. `execution.integration.test.ts`
starts loopback Anvil with disposable synthetic funds and exact upstream runtimes;
checks standard deployment, payer-funded atomic rotation, external nonrotating
transactions, failure rollback and phrase recovery plus mandatory recovery rotation.
Recovery tests reject any getLogs call, exercise multi-page local derivation and
owner changes during activation, and retain known exposure/reserved indices.
Run with `anvil` on PATH; no real chain broadcast is performed.

`fixtures/*.json` are canonical Safe 1.4.1 deployed runtime artifacts, retrieved by
`scripts/bunker-safe-fixtures.ts` and checked against the pinned upstream
@safe-global/safe-deployments 1.37.60 addresses/code hashes. They are test fixtures,
not authored contracts. Upstream Safe contracts are LGPL-3.0; provenance is
https://github.com/safe-global/safe-smart-account/tree/v1.4.1.

Browser scripts use a fresh temporary Chromium profile and synthetic keys. Never
log, screenshot or retain recovery words or signed calldata in QA output.

`pnpm exec tsx scripts/bunker-setup-qa.ts` runs disposable Chromium + Anvil checks for the intro, Create/Restore modes, deployment address/payer, and deferred phrase backup through Home (both themes at 320/420px). It never uses the real browser profile or funded accounts.
