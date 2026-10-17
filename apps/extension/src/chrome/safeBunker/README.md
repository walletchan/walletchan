# Safe Bunker

Standard Sepolia Safe 1.4.1 with a dedicated fully hardened seed owner. WalletChan
appends an atomic owner rotation to each execution. Another local/seed/Ledger
account pays native outer gas. No custom contract, guard, relay or reimbursement.

Review in this order:

1. `record`, `derivation`, `crypto`, `repository`, `drafts`, `integrity`: dedicated
   seed, purpose-bound per-entry DEK, master reveal and vault lifecycle integrity.
2. `types`, `stateCodec`, `stateRepository`: encrypted revision-bound journal and
   public projections. Signed envelopes never enter UI DTOs or normal pending storage.
3. `network`, `deployments.json`, `deployment`, `live`: chain/runtime pins,
   deterministic standard factory setup, creation receipts, live Safe authority.
4. `ingress`, `inbox`, `authorization`, `barrier`, `cancellation`: unsigned intake,
   pinned account/origin/topic checks, reset claims and revocation handling.
5. `transaction`, `operations`, `payer`, `broadcast`: CALL-only batches, mandatory
   rotation, exact review, durable-before-RPC signatures, exact payer simulation,
   local/hardware final release under wallet-secret operation lock. RPC errors
   containing signed calldata are never logged or returned by Bunker transport.
6. `reconciliation`, `recovery`, `publication`, `management`, `view`: canonical
   confirmed execution/owner evidence, same-byte retries, current-owner recovery with local derivation,
   master recovery rotations, result fanout, activity and guarded local removal.

Only Sepolia is enabled. WalletConnect/injected signatures, EOA delegation,
permissions, sponsored/force-included execution and Shield are unsupported.
Same-chain swap CALLs use the coordinator; cross-chain bridges remain unavailable
because no destination Safe is verified and current providers do not quote Sepolia.
A standard Safe can be used externally without rotating: client policy is not an
onchain restriction or post-quantum guarantee. Phrase restore requires the Safe
address and original factory deployment transaction; copy public recovery details.

`preflight.ts` owns the single block-pinned mutable-state and gas-capped exact simulation check after payer signing. Review verifies deployment infrastructure. `progress.ts` emits fixed public stage hints; no secrets or raw bytes. Historical checks stay in reconciliation.

`requestPolicy.ts` is the single approval/in-flight classification used by both
notification metadata and renderer selection. Outer-enveloped executions leave
approvals immediately; settlement and explicit same-byte retry stay separate.

`backup.ts` owns the master-only explicit backup acknowledgment used by the existing confirmSeedBackup route. It atomically retains the encrypted acknowledgment and clears the public account reminder; no phrase is returned.

`deploymentPublication.ts` validates signed factory identity, publishes an explicit
pending account after broadcast, and repairs both Safe/payer deployment history
rows without releasing signed calldata. integrity.ts accepts the bound pending
account during hydration; stateForAccount still denies owner execution until
canonical deployment activation clears deploymentPending.
