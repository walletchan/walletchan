# Safe Bunker tests

Shared-phrase foundation: `chainIdentity.test.ts` checks the frozen independent
v2 owner derivation and v3 module-enabled address vectors and strict selector/identity validation.
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

ERC-4337 fixtures: Safe4337Module/SafeModuleSetup are released
@safe-global/safe-4337 0.3.0 artifacts, with the module constructor bound to
EntryPoint v0.7. EntryPoint is @account-abstraction/contracts 0.7.0, with its
SenderCreator immutable resolved to CREATE(canonical EntryPoint, nonce 1).
Safe module/setup are LGPL-3.0 and EntryPoint is GPL-3.0; they are upstream test
bytecode, not new WalletChan contracts. Execution tests compare local native and
ERC-20 SafeOp hashes against the released module and run handleOps on two local
chains. Provider fixtures do not establish live Pimlico acceptance.

Submission regressions cover send acknowledgement/mismatched hashes, redacted
HTTP/RPC/AA-code failures, confirmed expiry of ambiguous releases, consumed nonce
blocking, durable signature/hash/reservation retention, dropped history repair,
and real EntryPoint settlement when the bundler receipt service fails. No browser
is launched by these Node/Anvil tests.

`feeQuoteErrors.test.ts` covers the recognized paymaster token-collection failure
through step and transport error normalization, precise auth/pending/configuration
messages, and redaction of unrelated RPC text without falsely claiming insufficient
funds.

`execution.integration.test.ts` verifies inline staging preserves durable unsigned
intent and permits immediate rejection without automatic navigation. Normal
request creation still notifies and account/chain mismatches remain rejected. UI swap tests cover the separate Bunker route
and preserve ordinary EOA, Safe proposal, hardware and view-only dispatch.

`swapMetadata.test.ts` checks additive old/new journal compatibility, bounds and
internal provenance. History tests retain pair/icons through compaction, and the
UI row regression ensures a decoded Exec call cannot override the swap label.

`transferMetadata.test.ts` covers native/ERC-20 Send snapshots, recipient/value
binding, optional journal decoding, native CALL caps and prefund/deposit math.
The real EntryPoint integration also executes a native MAX transfer after
review reduces its amount, proving final signed simulation and rotation succeed.

`swapContext.test.ts` covers optional review context, exact bounded decoding,
internal provenance, group member metadata and saved-payer identity/capability.
The local contract integration verifies group/separate preservation, unsigned
stale-payer projection, and native MAX calldata execution through Safe4337Module.
UI regressions cover restored overview/acknowledgement, once-only refresh,
reject-before-refresh and lock/signed-race navigation barriers.

`journalCapacity.test.ts` covers byte pressure below ninety records, count
retention/idempotence, pre-signature EOA envelope/recovery reserves and fail-closed
retention of live signatures, current-owner expired signatures and undelivered
results. The execution integration exercises actual reorg recovery of a saved
anchor, agent/stale-master/chain/hash failures without writes, preserved signature
and successor evidence, explicit recovery rotation and post-compaction execution
and settlement on both disposable chains. No browser is launched.
