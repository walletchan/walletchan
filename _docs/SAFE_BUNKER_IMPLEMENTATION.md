# Safe Bunker implementation and acceptance

Date: 2026-10-16. Branch: `codex/safe-bunker-new`.
Workspace: `/Users/apoorvlathey/.codex/worktrees/safe-bunker-new/walletchan`.
Build: `apps/extension/build/` in that workspace.

## Delivered scope

- Dedicated encrypted seed, hardened derivation, master phrase reveal and existing
  password/agent/passkey lifecycle integration.
- Sepolia-only standard Safe 1.4.1 factory deployment, deterministic identity,
  canonical code/creation verification and three-confirmation activation.
- PK/seed/Ledger outer gas payer selection and optional per-Bunker default.
  No custom contracts, guard, relay, reimbursement or hidden-owner account.
- Native/ERC-20 CALL intake through existing Send; native MAX uses the Safe balance
  with gas external. Canonical CALL-only batches append exactly one owner swap.
- Pinned injected/ERC-5792/WalletConnect requests and unsigned cross-dapp grouping;
  call decoding, Safe asset preview, fee controls and one execution confirmation.
  Incoming requests use the shared transaction confirmation composition, a compact
  footer gas-payer picker and the existing anchored gas chooser. Fees prepare
  automatically; submission returns to the Bunker account’s Home Activity.
- Encrypted durable signature/execution journal; actual payer simulation, final
  auth/origin/topic/config gates, no signed calldata in UI/error logs, identical
  raw retries and bounded unlocked reconciliation without automatic broadcasts.
- Receipt/event/hash/owner evidence, external execution discovery, independent
  Safe nonce/index tracking, recent-anchor reorg detection and recovery gating.
- Master phrase/public-details restore with paged history and derivation, unknown
  exposure acknowledgement and a fresh rotation before spending. Recovery skips
  known exposed successors and retains competing signatures until canonical proof.
- Safe-address activity, copyable public recovery details, guarded removal,
  disconnect-before-delete and unresolved-effect reset protection.
- Same-chain swap CALL adapter uses the same coordinator. Current quote providers
  do not support the enabled Sepolia network; cross-chain bridges remain explicitly
  unavailable without verified destination Safe/settlement support.

## Automated and rendered evidence

The disposable Anvil integration uses hash-checked upstream Safe/factory/
MultiSendCallOnly runtime fixtures and synthetic funds. It exercises deployment,
unfunded owner address/nonce, PK and actual imported seed-phrase gas payers,
atomic rollback, grouped calls/one rotation, duplicate Confirm rejection, external
nonrotating nonce changes (including before receipt reconciliation), failed signed
simulation and reuse, same-nonce recovery skipping exposed successors, external
execution discovered by Safe hash, chain reorganization and phrase recovery.

Focused account, Safe, pending request, WalletConnect, signature, transaction,
Ledger no-device, sponsored/batch, auth and factor regressions pass. Extension
UI architecture/presentation suite: 450 tests. Typecheck, scoped lint and the full
`pnpm build:extension` pass, including all manifest targets, privacy budgets and
license packaging. Build emits existing Rollup PURE-annotation/chunk-size notices.

`scripts/bunker-foundation-qa.ts` uses a disposable Chromium profile to check
creation, phrase reveal/wrong master proof, persistent reload, idempotency, agent
restrictions and six theme/width states. Evidence: `/tmp/bunker-foundation-qa/`.

`scripts/bunker-execution-qa.ts` runs the packaged extension against loopback Anvil:
UI creation/deployment/default payer, user-call review, shared asset simulation,
confirmation, Home Activity navigation and verified transfer/rotation. Cold reload
resumes the review; fee preset changes re-review automatically. Six 320/420/1280 theme/width states
have no horizontal overflow, serious/critical axe findings or page errors.
Evidence: `/tmp/bunker-execution-qa/`. Screenshots were visually inspected; no
recovery phrase or signed envelope is logged or captured.

## Remaining acceptance boundaries

- Real Ledger approval/rejection/disconnect and real WebAuthn device ceremonies
  require device QA. Automated no-device and factor regressions are not that QA.
- A funded Sepolia rehearsal is separately authorized work. No real funds or
  real-chain transactions were used for this implementation.
- Browser width checks use real extension documents in Chromium tabs; native
  popup/sidepanel windowing and Firefox interactions still need hands-on checks.
- Live swap/bridge provider routes are not available on this Sepolia-only scope.
  Do not advertise a successful swap or bridge, mainnet support, PQ protection,
  protection from a compromised seed, or enforced rotation in another Safe UI.
- Recovery requires phrase, Safe address and original standard factory deployment
  transaction. Unknown current owners or changed Safe configuration block signing.
  Unavailable history/search continues explicitly; it never guesses an owner.
- Storage is bounded and fails closed while preserving recovery data. This is not
  a fixed 256-owner protocol. Do not downgrade a profile to an unaware binary.

No commit, push, PR, release or contract deployment was performed.

### Sepolia RPC verification repair

The shipped dRPC endpoint returned HTTP 400/-32601 for `eth_blockNumber` during
live diagnosis. PublicNode’s documented Sepolia endpoint passed chain identity,
all three pinned infrastructure hashes and the affected Safe’s onchain configuration
checks. The shared chain registry/default normalizer now repairs old saved defaults
without replacing custom endpoints. Owner derivation, nonce, configuration, reorg
and final submission checks remain required. Verification was read-only.

### Bunker confirmation latency

Review owns canonical Safe/factory/MultiSend code verification, owner discovery,
gas estimation and fee preparation. Independent fee, gas and balance reads run
in parallel. Review saves the existing operation.scanBlock as an exposure-scan
anchor without adding a storage field. Historical block-anchor checks run in
background reconciliation, never in review or Confirm.

Confirm validates the live session, review/indices/call hash and origin authority
locally, derives the owner/successor and persists the Safe signature before any
signature-bearing RPC. It then signs the payer envelope. Local preparation fills
only the payer nonce (explicit chain/type/gas/fees prevent eth_fillTransaction
or re-estimation from changing reviewed values). Ledger approval precedes the
same final preflight as local signing.

safeBunker/preflight.ts chooses one fresh block and checks current chain,
singleton/version, owner, nonce, threshold, modules, guard/fallback and owner/
successor code/sender nonces. These reads, payer balance and one exact eth_call
run in parallel at that block. The exact simulation uses the actual Safe
signature, payer and reviewed gas ceiling; Confirm makes no eth_estimateGas call
and does not re-fetch deployment bytecode or historical blocks. Auth/origin gates,
review expiry and durable outer-byte persistence remain immediately before release.

The background emits safeBunkerExecutionProgress containing only account ID,
request ID and an allowlisted phase: signing, checking, broadcasting, submitted.
The exact busy renderer accepts only same-extension background hints, displays
Signing / Checking / Broadcasting, and returns to Home Activity after broadcast
and durable pending/ambiguous status. Dapp result/history publication continues
in the awaited background operation, with the ordinary response as a fallback
if the hint is missed. Hints grant no authority and are not forwarded to dapps.

### Activity and executor history

Bunker history stores `safeBunkerMeta` with only the public user calls and
operation kind, excluding the automatic owner rotation, signatures, and raw
outer bytes. Activity reuses normal Safe action naming and local calldata
resolution; transaction details reuse the shared per-call summary, including
multi-call requests. Compaction retains this optional snapshot, because an
outer RPC transaction cannot reconstruct the Safe's synthetic inner history
row by matching its sender/target. Details resolve inner calldata locally.

The gas payer gets a separate normal EOA history row with `safeExecutionMeta`
(`Execute Safe Tx #n`), actual outer nonce and reviewed gas fields. Standard
receipt polling owns its status, paid gas, and asset enrichment. Bunker asset
changes do not add payer gas back to the Safe's native balance delta. Journal
reconciliation repairs earlier history projections idempotently before chain
reads, including already-published confirmed operations; missing optional
metadata remains compatible with existing records. No new storage key or
signing/authorization behavior is introduced.

### Compact decision footer

Transaction requests share `DecisionAccountSelector` with normal Safe proposals:
identity and eligible account choices stay in an anchored menu. The saved payer
is selected on entry. “set default payer for future” appears beneath the payer
only after explicitly selecting a different account, and resets on selection.
Deployment retains its setup picker. Gas fees share the normal compact native
fee formatter and anchored fee control. Expired reviews refresh automatically
while idle; failed preparation offers Retry with the existing diagnostic message.
Signing, payer eligibility and digest-bound background authorization are unchanged.

## Dedicated account settings

Bunker settings now uses the normal account identity/name editor, grouped settings
rows and semantic tokens. Public details show network, last verified owner index
and recovery status. Recovery details, existing master phrase reveal, owner
recovery review/scan and backup-acknowledged removal are focused destinations.
There is no request queue or payer control in settings. Pending approvals stay
in the Home banner/normal request flow.

Packaged Chromium QA covers both themes at 320/420px, name save, public-details
copy, password-gated phrase entry, recovery review/rejection/Back, removal cancel,
wrong password, successful account-list refresh and archive retention. The shared
account identity badge now retains contrast in Bauhaus. Bunker tests also prove
that sync quota failure preserves the account/journal before a successful retry.
The full extension build, typecheck, targeted lint, 456 UI tests, 53 Bunker tests
and 5 account-policy tests pass. No signer/device behavior is changed by settings.

Setup does not list or resume unfinished preparations. Create new opens only the
current creation flow. Encrypted preparation remains internal for sign-once
submission and reconciliation; broadcast publishes a pending
account for Activity, while only verified, confirmed deployment activates owner execution. Closing the renderer does not delete pending deployment recovery data.
