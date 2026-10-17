# Safe Bunker tests

Shared-phrase foundation: `chainIdentity.test.ts` checks the frozen independent
v2 derivation/address vectors and strict selector/identity validation.
`chainDeployment.integration.test.ts` verifies actual standard-factory deployment
on two independent disposable chains, deterministic reimport and duplicate
rejection. These pure identity checks are complemented by the full runtime tests below.

`foundation.test.ts` covers normal zero-EOA mnemonic groups, journal encryption,
strict source bindings, master-only access, stale auth, backup and password/passkey
transitions. No stored branch key or duplicate Bunker phrase exists. `execution.integration.test.ts`
runs against two separate loopback chains (11155111/84532), disposable synthetic
funds and exact upstream runtimes;
checks standard deployment, payer-funded atomic rotation, external nonrotating
transactions, failure rollback and exposure-aware manual recovery. Explicit Add
existing revalidates the source/current owner without forcing recovery rotation.
Recovery tests reject any getLogs call, exercise multi-page local derivation and
owner changes during activation, and retain known exposure/reserved indices.
Run with `anvil` on PATH; no real chain broadcast is performed.

`fixtures/*.json` are canonical Safe 1.4.1 deployed runtime artifacts, retrieved by
`scripts/bunker-safe-fixtures.ts` and checked against the pinned upstream
@safe-global/safe-deployments 1.37.60 addresses/code hashes. They are test fixtures,
not authored contracts. Upstream Safe contracts are LGPL-3.0; provenance is
https://github.com/safe-global/safe-smart-account/tree/v1.4.1.

UI regressions in tests/ui/bunker*.test.ts cover source discovery states,
default-payer hydration and preloading. The preloading suite checks parallel code/
view reads, code-only caching, identity mismatch, late opens after lock/removal,
error routing and immediate seeded confirmation without duplicate mount reads.
The full execution integration also checks a remembered payer through encrypted
persistence and the next request's public projection.

From apps/extension:

```sh
pnpm exec tsx --test tests/safeBunker/*.test.ts
pnpm exec tsx --test tests/ui/bunker*.test.ts tests/ui/architecture.test.ts tests/ui/moduleSizeBudget.test.ts
```

Real Chrome acceptance is assigned to the user. Browser QA scripts are maintenance
helpers; their existence is not evidence that the latest UI has passed browser
acceptance. Use only disposable profiles, synthetic keys and local chains when
updating/running them. Never log, screenshot or retain recovery words or signed
calldata. Physical Ledger and public-network acceptance are separate from these
synthetic tests. Trezor uses the shared Safe executor policy and exact-envelope signing; physical device QA remains outstanding.
