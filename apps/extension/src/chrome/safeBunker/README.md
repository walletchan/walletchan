# Safe Bunker

A standard Safe 1.4.1 per ordinary mnemonic group and chain. Fully hardened,
domain-separated owner derivation uses the chain ID; Safe addresses differ
between chains and remain stable across rotations. No custom deployment contract.

All commands, source access, review/signing, retries and recovery require a live
master session. Agent passwords cannot execute Bunker operations. `sources.ts`
reads the original phrase through the existing mnemonic capability. No separate
phrase, xpriv, branch key or wrapped Bunker signing capability is persisted.
Password and biometric master sessions use the normal mnemonic vault.

Audit order:

1. `access`, `sources`, `chainIdentity`, `chainOwnerDerivation`, `deploymentIdentity`:
   authority, exact derivation, scoped keys, deterministic standard-factory identity.
2. `record`, `repository`, `drafts`, `crypto`, `integrity`: public source/chain
   bindings and authenticated journal lifecycle, no duplicate phrase encryption.
3. `types`, `stateCodec`, `stateRepository`: revision-bound encrypted operation
   journal; no signatures/exact envelopes in public projections.
4. `network`, `deployments.json`, `deployment`, `deploymentPublication`, `live`:
   per-chain code/chain pins, deterministic setup, canonical receipts/authority,
   pending-account Activity and Safe/payer history publication.
5. `discovery`: read-only confirmed probes and bounded local owner search;
   explicit Add existing rechecks ownership, preserves exposure, requires no tx.
6. `ingress`, `inbox`, `authorization`, `barrier`, `cancellation`: unsigned intake,
   pinned account/chain/origin/topic, reset and revocation gates.
7. `transaction`, `operations`, `preflight`, `payer`, `broadcast`: CALL-only
   execution with final rotation, durable-before-RPC signatures, exact gas-capped
   simulation and final authority gate after local/hardware payer approval.
8. `reconciliation`, `recovery`, `publication`, `management`, `view`: canonical
   confirmation/reorg proof, same-byte retries, exposure-aware recovery,
   result delivery and guarded removal. `accounts/seedRemoval.ts` owns shared
   last-account phrase cleanup and deletion of Bunker bindings/journals.

Storage: `safeBunkerBindingsV2` public headers, `safeBunkerJournalsV2` encrypted
state, existing unsigned inbox/notification keys. Source and backup belong to
normal mnemonic groups, including zero-EOA groups. No alpha compatibility reader.
See `_docs/SAFE_BUNKER_DERIVATION.md`, `_docs/STORAGE.md` and `_docs/SAFE_BUNKER_IMPLEMENTATION.md`.

Only chains with verified frozen canonical EVM infrastructure work; unsupported
profiles fail closed. Bunkers are bound to one chain, never direct signers or gas
payers. Local PK/seed/Ledger accounts pay outer native gas. Provider signatures,
delegation, permissions, sponsored/force-included execution and Shield remain
unsupported. External Safe tooling can bypass rotation; this is client policy,
not an onchain restriction or post-quantum guarantee.
