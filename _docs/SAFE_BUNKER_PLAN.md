# Safe Bunker: standard Safe with client-managed owner rotation

Status: Phases 1–5 implemented for the initial Sepolia scope. Phase 6 local-EVM
and rendered browser checks pass; real Ledger and separately authorized funded
Sepolia rehearsal remain pending. Cross-chain bridges and live swap quotes remain
unavailable on the enabled network. Implementation and acceptance evidence:
[SAFE_BUNKER_IMPLEMENTATION.md](./SAFE_BUNKER_IMPLEMENTATION.md).
Historical Phase 1 boundary: [SAFE_BUNKER_PHASE1.md](./SAFE_BUNKER_PHASE1.md).
Date: 2026-10-16.
Workspace: `/Users/apoorvlathey/.codex/worktrees/safe-bunker-new/walletchan`.
Branch: `codex/safe-bunker-new`, starting from local master `7f33e0f3`.

## 1. Agreed direction

Safe Bunker is a distinct WalletChan account backed by a standard 1-of-1 Safe.
WalletChan generates a dedicated encrypted seed, keeps its owner keys internal,
and appends an owner replacement to every Bunker transaction it executes.
Another eligible wallet account pays the outer transaction's native gas. The
user can select that payer and check a box to remember it for future operations.

The Safe address remains stable as its signing owner changes. Receive,
portfolio, dapp connections and transaction history identify the Safe address.
The payer has no authority over Safe assets merely by submitting a transaction.
The public onchain association between payer and Bunker is accepted.

The exact product promise is: **every successful Bunker transaction executed
through WalletChan includes an atomic owner rotation**. Other clients can execute
standard Safe transactions without rotation if they have current owner signing
authority. Hidden-key handling means external UIs still need an independent way
to obtain that authorization; contract compatibility alone does not supply it.

There are no custom contracts, guard, executor, deployment helper, relay service,
Safe-native gas reimbursement, refund quote API, Merkle successor commitment,
fixed 256-owner commitment, or post-quantum authorization in this design.
No contracts repository clone or contracts branch is needed for implementation.
Use upstream Safe contracts and reviewed canonical deployments. Local EVM tests
may use pinned upstream artifacts without introducing deployable Bunker contracts.

Implementation proceeds one user-directed step at a time. The user authorized
Phase 1 on 2026-10-16; that does not authorize later phases, deploy, commit or publish.

## 2. Current-master foundations to reuse

Paths below are relative to `apps/extension/src/`:

| Existing owner | Reuse and boundary |
| --- | --- |
| `chrome/safe/transactionBuilder.ts` | Standard Safe hash/batch construction; already sets inner `safeTxGas`, `baseGas` and `gasPrice` to zero and gas token/refund receiver to zero addresses. |
| `chrome/safe/multiSend.ts` | Bounded CALL-only inner batch encoding/decoding: 100 calls and 128 KiB total inner calldata. Reserve capacity for the rotation. |
| `chrome/safe/executionData.ts` | Exact `execTransaction` calldata and standard signature packing. |
| `chrome/safe/deploymentRegistry.ts` | Reviewed canonical Safe/MultiSend deployment lookup. Audit factory/singleton support before adding creation. |
| `chrome/safe/execution.ts` | Native payer gas estimation, local/Ledger dispatch, final auth/account checks, effect claims and receipt reconciliation. Extract small reusable primitives if necessary. |
| `chrome/safe/accountTypePolicy.ts` | Exhaustive owner/executor eligibility. Current native executors are private-key, seed-phrase and Ledger accounts; Bankr cannot execute. |
| `components/SafeApprovals/safeProposalActionModel.ts` | Executor choices and initial-selection logic. |
| `components/SafeApprovals/SafeProposalConfirmation.tsx` | Existing executor picker and gas review composition. Reuse the UX without exposing a Bunker proposal inbox or owner picker. |
| Existing vault/auth/history/request infrastructure | Secret-operation locking, current auth epochs, factor transitions, pinned request routes and result publication. |

Current executor selection is component state with a derived initial choice.
A durable, user-selected default payer is proposed work; do not assume the
existing `getDefaultSafeExecutorAccountId` helper already persists it.
Existing Safe proposal storage is not automatically the right Bunker journal.
Reuse reviewed primitives without manufacturing public proposals or storing a
hidden owner as a regular account solely to satisfy the old API.

Read `_docs/IMPLEMENTATION.md`, `_docs/STORAGE.md`, `_docs/SECURITY.md`,
`_docs/PUBLISHING.md`, `_docs/TX_CONFIRMATION.md`, and the UI architecture/style
docs before their respective implementation changes.

## 3. Account, seed and derivation

- Add `safeBunker` as a contract account, never a direct EOA signer or eligible
  imported-Safe owner/payer. Preserve exhaustive capability tables.
- Public account metadata binds account ID, Safe address, chain ID, Safe version,
  derivation version and seed-vault reference. Initially one Bunker account is
  bound to one chain; no implicit cross-chain owner synchronization.
- Generate a separate 12-word BIP39 seed in trusted background code. Freeze
  hardened derivation `m/44'/60'/0'/0'/n'` with independent test vectors before
  using it for funded accounts. Owner zero is initial; successive executions
  use increasing indexes. The hardened index range remains finite, but there
  is no precommitted 256-owner limit.
- Encrypt each seed using the existing reviewed vault pattern, with an
  account-specific DEK and authenticated immutable identity. Do not cache or
  persist derived private keys, xpubs or chain codes.
- Derive keys only within the background signing call. Clear mutable temporary
  buffers where possible; do not claim reliable erasure of JavaScript strings.
- Ordinary authorized master/agent/passkey-unlocked sessions may execute, under
  existing session policy. Creation, seed reveal, restoration and destructive
  management require master authority. Agent execution never grants seed reveal.
- Reuse the master-authorized seed reveal screen. Individual owner-key reveal
  stays unavailable; no separate backup password or encrypted-file backup flow.
- Derive the next index from verified rotation evidence and seed ownership, not
  from the Safe nonce. External transactions can advance nonce without rotation.

## 4. Creation and deployment

1. User selects Safe Bunker in Add Account and names it.
2. Background creates an idempotent encrypted draft and initial owner. A lost
   response must reopen the same draft rather than generate another seed.
3. Resolve reviewed upstream Safe factory, singleton, proxy creation code and
   CALL-only MultiSend support for the selected chain. Refuse unsupported chains
   before presenting a funding/deployment destination.
4. Prepare standard Safe initialization: one owner, threshold one, no guard,
   modules, fallback handler or setup delegatecall; payment zero. Predict the
   address using the canonical factory and persist initializer/salt identity.
5. User selects an eligible gas payer, optionally remembering it. Estimate and
   review the exact factory call from that payer. No Safe prefunding is required
   to cover deployment gas, and no payer address is baked into a setup refund.
6. Payer signs/submits standard factory creation. Save submission identity before
   network release and reconcile lost responses without deploying another Safe.
7. Verify canonical receipt/factory event, deployed code, singleton, owner,
   threshold and configuration before activating the account.

Keep the deployment identity available for restart and recovery. Changing payer
must not change the predicted Safe address. Draft deletion is permitted only
when it cannot discard a deployed, funded or ambiguously submitted identity.
Creation may show the seed backup screen but must describe completion honestly;
merely opening reveal does not prove the user saved the phrase.

## 5. Gas payer selection and default

Proposed default scope: per Bunker account (already chain-bound), stored as an
account ID plus address binding. It is a convenience preference, never execution
authorization. Label the checkbox "Use as default for this Bunker".

- List eligible existing accounts using the Safe executor policy. Initially
  private-key, seed-phrase and Ledger are supported; Bankr, impersonator, imported
  Safe and another Bunker are excluded. Bankr support is a separate transport
  decision, not an implicit consequence of being a signing account.
- Reuse the default on deployment and later transaction reviews. Allow changing
  or clearing it. Persist only when the checkbox is deliberately selected;
  an unchecked one-off choice must not overwrite a saved default.
- If missing, removed, incompatible or differently bound, require selection.
  Never silently switch to another payer and submit. An insufficient balance or
  disconnected Ledger requires funding/reconnection or deliberate payer change.
- Gas is estimated on the outer factory/`execTransaction` call from that payer.
  Reuse tiers, overrides, balances, loading/validity and Ledger waiting behavior.
- Validate payer authority, chain, account identity and final gas overrides in
  the worker immediately before signing/broadcast. A stored preference cannot
  bypass those checks or hardware confirmation.
- Payer needs native value for network fees; Safe needs value for user calls.
  Gas overrides belong to the outer transaction, not Safe reimbursement fields.
- A payer change invalidates sender-dependent simulation and outer fee review.
  The same inner Safe signature may remain usable because no refund payer is
  signed into it; do not create another conflicting Safe envelope as a shortcut.
- Native gas only initially. Fee-token sponsorship and relays remain outside
  this plan. Concurrent ordinary payer transactions share existing nonce control.

## 6. Canonical transaction preparation

All enabled transaction surfaces use one background Bunker preparation path.
The renderer supplies unsigned intent/request identifiers, not system calls,
owner index overrides, private keys or signed Safe envelopes.

1. Pin Safe/account/chain and originating dapp or WC topic/request.
2. Read live Safe configuration and nonce at a consistent block. Require the
   supported singleton, exactly one expected owner, threshold one, and no
   unreviewed modules/guard/fallback. External configuration changes require
   explicit reconciliation; do not silently adopt a different security model.
3. Match current owner to the dedicated seed, then derive a fresh successor.
   Refuse used/retired successors and never equate owner index with Safe nonce.
4. Validate user CALLs and reserve one batch slot for `swapOwner`. For the existing
   100-call encoder this means at most 99 user calls, within calldata bounds.
   User-supplied delegatecalls, nested system batches, Safe configuration calls,
   owner funding and hidden-owner permit/signature requests are unsupported.
5. Append `Safe.swapOwner(address(1), currentOwner, nextOwner)` as the final CALL.
   Exactly one rotation is background-generated; no custom metadata marker.
6. Build a standard MultiSendCallOnly Safe transaction, including for one user
   call. Pin `safeTxGas = baseGas = gasPrice = 0`, `gasToken = refundReceiver = 0`.
   Keep these inner fields separate from nonzero outer gas limit/EIP-1559 fees.
7. Bind review to canonical calls, Safe hash/nonce/configuration, successor and
   payer/gas review context. Show decoded user actions, automatic rotation, fees
   and assets using existing review components. Invalidate review on changes.

With the pinned Safe zero-gas reimbursement fields, inner failure must revert
outer execution (Safe's `GS013` behavior), rather than consume the nonce while
reporting failure. Prove this with actual pinned Safe artifacts, including an
out-of-gas batch and failed final owner replacement. Never relax these inner
fields as an estimation workaround.

## 7. Signing, submission and durable operation state

Maintain one unresolved signed operation per Safe. Other requests remain unsigned.
The background owns a per-account execution claim, combined with existing secret
and auth-transition locking. Do not hold unrelated global locks across receipt
polling or hardware interaction.

Proposed lifecycle:

```text
queued -> reviewed -> preparing -> signed -> submitting -> pending -> confirmed
                                      \-> ambiguous -> reconcile
queued/reviewed -> rejected
confirmed outer revert -> failed; Safe owner unchanged; exposure retained
external nonce/configuration change -> reconciliation required
```

Before any real signature reaches RPC simulation, payer signing or other external
boundary, persist the exact signed Safe envelope and exposure marker encrypted.
Persist payer serialized transaction/hash before broadcast where its transport
supports sign-once release; unknown outcomes remain recoverable.

Verify live auth epoch, pinned requests/origins/topics, account identities, Safe
owner/nonce/configuration and review digest before secret use and final release.
Rejection is available for unsigned requests. A signed operation cannot be made
safe by deleting its local row, closing the popup or advancing the owner index.

Simulate and estimate the exact signed `execTransaction` from the selected payer
before broadcast. Pre-sign previews are allowed only when clearly distinguished
from exact execution; do not use a payer-as-owner shortcut when it is not owner.
A real signature sent for simulation already counts as exposed, even on failure.

No automatic fresh signing or blind resubmission after a timeout. Recover by
looking up deterministic hashes and canonical chain evidence. Outer fee bumps
may retain the same inner signature; payer replacement/cancellation does not
cancel an inner Safe signature that another address could still execute.

Unsigned review expiration is a client policy. Standard Safe signatures have no
built-in wall-clock expiry here; do not display them as invalidated by time.
If a signed intent must be invalidated, explicitly authorize a same-Safe-nonce
rotation-only batch and retain both competing envelopes until a winner is
verified. Explain that the original can win the race. No general arbitrary
same-owner re-signing of changed calls is permitted during uncertainty.

## 8. Receipts, failures and external clients

- Outer receipt success alone is insufficient. Match the exact Safe execution
  event/hash and expected owner removal/addition, then verify canonical live
  owner/nonce/configuration at the chain's confirmation depth.
- Only confirmed evidence advances the local owner index. Keep prior evidence
  so reorgs can invalidate progress rather than make the wallet sign blindly.
- A reverted batch leaves owner and user calls unchanged; payer still pays gas.
  Retain the signed envelope because a reverted outer transaction does not
  inherently invalidate that Safe signature for another attempt.
- Restart/unlock/alarm reconciliation is bounded and uses existing mechanisms
  where practical. No relay scheduler, relay quote state or automatic rebroadcast.
- External execution without rotation may advance nonce while owner is unchanged.
  Reconcile historical evidence, invalidate stale review and rebuild deliberately.
- An external rotation to a known seed-derived address can be reconciled after
  proof. An unknown owner or altered configuration blocks Bunker execution and
  offers clear status; do not rotate it back or overwrite local state silently.
- External execution of an exposed Bunker envelope is recognized from Safe events
  even when its payer is different. Payer-specific receipt lookup cannot be the
  sole way of determining success.
- Activity presents one Bunker action with its rotation and payer information.
  Payer gas expenditure can appear in its normal account history, linked to that
  action. Avoid treating rotation as a second user-requested transfer.

## 9. Recovery, removal and storage

Recovery must work without trusting an old local owner index or a Safe Transaction
Service. The seed alone does not encode an arbitrary factory salt/Safe address.
Document recovery inputs as seed + chain + Safe address; original deployment
transaction/creation metadata can assist discovery and must be retained locally
and made available as public recovery details.

Restore verifies canonical deployment/configuration and matches onchain owner
against bounded local seed derivation without eth_getLogs or historical owner
reconstruction. The restore UI drives sequential derivation pages and retains
checkpoints on interruption. Revalidate the current owner and full configuration
before activation. Freeze metadata derivation/version rules before release. If
the owner cannot be found or RPC reads fail, retain recoverable data instead of
guessing an index.

A restored seed cannot establish that the current owner has never signed an
unbroadcast transaction elsewhere. Mark exposure unknown and require an explicit
master-authorized rotation-only recovery before ordinary spending. This still
has a race with other valid current-owner signatures; no onchain guard or PQ
protection is claimed. Multiple devices sharing a seed need live-state checks;
concurrent conflicting signatures cannot be prevented globally by a local lock.

Proposed additive storage responsibilities (final key names require reader/writer
audit before implementation):

| Record | Responsibility |
| --- | --- |
| `accounts` extension | Public Safe identity, chain/version and Bunker vault binding. |
| Bunker vault | Versioned encrypted dedicated seed and key wrapper. |
| Bunker operation journal | Encrypted signed envelopes, derivation/index evidence, deployment identity, unresolved claims and recovery status. |
| Pending requests | Bounded public unsigned intents, route provenance, review digests and result acknowledgements. Reuse existing repositories where semantics fit. |
| Payer preference | Public per-Bunker account/address reference; no signing authority. |

Use strict bounded codecs; missing records are valid for existing users, malformed
or future records fail closed and remain preserved. Audit reset, onboarding,
password rotation, master/agent factor changes, passkey hydration, lock, account
removal and downgrade behavior. Use idempotent lifecycle migrations if required;
do not rewrite unrelated Safe, mnemonic or private-key records.

Never erase the only local recovery material for pending/ambiguous execution.
Account removal requires a live master session and explicit seed/recovery-details
backup acknowledgement, without another password input. Local removal is not onchain deactivation or
signature revocation. Do not claim that a checkbox verifies a saved seed.

## 10. Supported surfaces and initial limits

| Surface | Planned behavior |
| --- | --- |
| Portfolio / receive | Stable Safe identity; chain-bound deployment status. |
| Native / ERC-20 Send | Canonical calls plus rotation; selected payer funds gas. |
| Native MAX | Can use the Safe native balance because gas is external; account for all user-call value and simulate the final exact envelope. Deliver after ordinary Send. |
| Injected transaction | Dedicated Bunker intent; actual outer transaction hash result after submission under existing route semantics. |
| ERC-5792 | Atomic batch with one rotation; preserve origin and bundle-status semantics. |
| Cross-dapp grouping | Group unsigned IDs only; one review/rotation, reauthorize all contributing origins and fan out results correctly. |
| WalletConnect | Safe address and supported deployed chain/methods; same coordinator and topic revocation checks. |
| Swap / bridge | Later phase using Safe-owned CALL approvals/routes and the same payer/rotation path. No hidden-owner permits; verify destination and settlement separately. |
| Message signing / SIWE / typed data | Disabled initially; separate contract-signature design required. |
| Imported Safe | Existing behavior unchanged; no automatic adoption of its owners into Bunker derivation. |
| Delegation / permissions / Shield / sponsored execution / force inclusion | Unsupported until independently scoped and reviewed. |

Expose only implemented methods/capabilities. Do not fall through to generic EOA,
Bankr or ordinary Safe owner-selection paths for unsupported Bunker requests.
Client restrictions protect WalletChan's behavior; they are not onchain rules
against another holder of the current owner key. Rotation is not a claim of
post-quantum authorization or protection against a compromised current seed/key.

## 11. UI and code boundaries

Use the current Warm Midnight/shared theme primitives and compact Safe gas-payer
UX. Bunker screens belong in a focused feature folder with a small background
account/rotation domain and README audit maps. UI hooks own presentation and
commands; background owns seed, transaction policy, persistence and final gates.

Creation, Send, request confirmation, account security and recovery should reuse
existing account/seed/fee components. One Confirm action authorizes hidden-owner
signing followed by payer signing; Ledger hardware approval remains necessary.
No extra owner account, proposal inbox or offchain-approval decision is introduced.

Keep system rotation distinguishable from user-requested owner management in
simulation and decoding. Preserve full-call warnings and exact asset outcomes;
do not silently omit the final call from execution simulation. UI DTOs must not
return seed, private key, signed-envelope journal or derivation internals.

## 12. Implementation sequence and acceptance gates

### Phase 1: account and secret foundation

Implement account policy, dedicated encrypted seed, frozen derivation, master
seed reveal and lifecycle integration. No funded account activation yet.
Gate: no generic signer/payer fallthrough, no owner-key reveal, idempotent drafts,
master/agent/passkey/lock/factor regressions and strict storage validation pass.

### Phase 2: standard deployment and payer selection

Implement canonical deployment planning/verification and payer picker/default.
Gate: real pinned Safe creation on disposable local EVM, payer pays gas with
zero hidden-owner balance/nonce, no Safe setup payment, repeat/restart recovery,
removed/default payer cases and no custom contract dependency.

### Phase 3: canonical rotating execution

Implement the common builder, signing/exposure journal, exact simulation, native
payer submission and reconciliation. Start with native/ERC-20 Send.
Gate: user calls and rotation succeed/revert together; live owner/index updates
only from evidence; double Confirm, signing failure, RPC timeout, Ledger rejection,
worker death, payer nonce competition and same-envelope retries are covered.

### Phase 4: external request integration

Integrate injected, ERC-5792, cross-dapp and WalletConnect adapters into the same
coordinator. Gate: queue unsigned work, one rotation per execution, pin every
route, handle revocation and return correct tx hashes/bundle statuses exactly once.

### Phase 5: recovery, Activity and broader actions

Complete bounded seed recovery, unknown-exposure rotation, external-UI changes,
reorg handling, removal and general Activity. Add native MAX, then explicitly
scoped swap/bridge routes through the existing confirmation system.
Gate: recovery works from phrase/public details without local operation history;
unsupported cases stay explicit; all enabled surfaces share payer/gas validity.

### Phase 6: rendered acceptance and testnet rehearsal

Browser-check creation, default payer, Send, pending/failure/recovery and Activity
in popup, sidepanel, fullscreen and narrow widths, both themes and keyboard use.
Run a separately authorized Sepolia rehearsal using canonical standard contracts.
Gate: deployment, successive rotations, payer switching and reload/recovery are
verified; no production claims based solely on preview fixtures or unit tests.

## 13. Validation, documentation and rollback

Required tests cover derivation vectors, exact batch/hash bytes, forbidden calls,
nonce/index independence, all storage failure boundaries, signed simulation
exposure, auth races, dropped/replaced outer transactions, unrelated external
Safe execution, external rotation and reorgs. Use real pinned upstream Safe and
MultiSend artifacts for atomicity evidence; mocks alone cannot prove it.

Exercise private-key and seed-phrase payers, Ledger no-device regressions plus
real-device QA, and Bankr's explicit payer rejection. Preserve all four existing
signer types' ordinary transaction/signature/Safe/WC paths and impersonator
rejection-only behavior. Test agent execution and master-only reveal/recovery
independently. State unperformed device QA and existing baseline failures honestly.

For extension changes run proportionate focused tests/typechecks/lint,
`pnpm test:extension-ui`, and mandatory `pnpm build:extension`, plus browser QA
for changed UI. A docs-only edit needs documentation/diff checks, no app build.
Keep IMPLEMENTATION, SECURITY, STORAGE, TX_CONFIRMATION and affected UI audit maps
in sync as behavior lands. Follow PR-only master when publication is requested;
commit/push does not authorize merge.

A feature gate may stop new creation/requests but must preserve encrypted seeds,
pending signatures, receipt reconciliation and recovery access. Disabling the
feature does not revoke an already released Safe signature. Do not downgrade to
an older binary that can discard unknown account/storage formats. Recovery or
conversion to an ordinary Safe must be an explicit later action, with seed and
unresolved-operation consequences explained; it is not an automatic rollback.

## 14. Reference policy and remaining decisions

The older `/Users/apoorvlathey/.codex/worktrees/safe-bunker/` is read-only reference
material. Reuse concepts/tests selectively; do not copy its guard, Merkle tree,
relay, refund, PQ, encrypted-file-backup or closed-service-registry architecture.
Its docs include superseded requirements. This plan and the current conversation
supersede those requirements for the new implementation.

Resolve these details in the relevant phase before funded use:

- Initial supported chains, exact upstream Safe version and verified factory/
  singleton/MultiSend pins; conservative proposal: Sepolia first.
- Exact storage schema and minimum compatible extension version.
- Local owner-derivation bounds and portable public recovery details.
- Chain-specific confirmation/reorg policy and recovery from changed Safe config.
- Whether default-payer preferences should later be shared with ordinary Safes;
  initial proposal is per-Bunker to avoid unrelated behavior changes.

No unresolved item justifies restoring custom relay/guard complexity implicitly.
