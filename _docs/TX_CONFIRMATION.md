# Transaction Confirmation Surfaces

**ALL transaction confirmation screens must offer the same gas-fee UX.** The wallet has multiple confirmation surfaces and they must stay in lockstep — when one ships a new gas feature, the others have to ship it too, or users get inconsistent behavior depending on how they triggered the tx.

## Confirmation surfaces today

| Surface | File | Underlying gas component |
|---|---|---|
| Single-tx confirmation (dapp-initiated) | `apps/extension/src/components/TransactionConfirmation.tsx` | `GasEstimateDisplay.tsx` |
| Batch tx confirmation (ERC-5792, dapp-initiated) | `apps/extension/src/components/BatchTransactionConfirmation.tsx` | `MultiTxGasEstimateDisplay.tsx` |
| Cross-dapp batch confirmation (user-assembled) | `apps/extension/src/components/CrossDappBatchConfirmation.tsx` | `MultiTxGasEstimateDisplay.tsx` (wraps BatchTransactionConfirmation) |
| **Swap / Bridge confirmation (internal)** | `apps/extension/src/components/Swap/SwapConfirmation.tsx` | `MultiTxGasEstimateDisplay.tsx` |
| **Safe approval / execution** | `apps/extension/src/components/SafeApprovals/SafeProposalConfirmation.tsx` | `GasEstimateDisplay.tsx` (execution and final-owner Sign & Execute) |

**When you change anything about gas params, the tier picker, validity, or override plumbing in ANY of these screens, audit the others.** The swap path in particular is easy to miss — it's its own confirmation UI separate from the dapp-initiated batch flow but uses the same underlying `MultiTxGasEstimateDisplay`.

**Cross-chain bridges ride inside the same `SwapConfirmation.tsx`** via the optional `bridgeMeta` prop (no new surface). When set, the title flips to "Confirm Bridge", the network row shows source → destination chains, and a Bungee route / ETA row appears. Gas plumbing is unchanged. After the source-tx confirms, `bridgeStatusPoller` watches `/api/bridge/status` and fires a destination notification — see [`BRIDGE.md`](./BRIDGE.md) "Extension support".

## Required wiring (PK / Seed accounts)

For any tx-confirmation surface:

1. Pass `isNonAtomic={true}` to `MultiTxGasEstimateDisplay` (or use `GasEstimateDisplay` for single tx) so the tier picker actually renders.
2. Wire `onGasEstimates` (or `onGasOverrides` for single tx) to a parent state.
3. Wire `onValidityChange` to a `gasValid` state and disable the Confirm button on `!gasValid`.
4. Send the gas estimates / overrides through to the background handler that signs the tx.
5. Make sure the background handler actually applies them at sign time (clears legacy `gasPrice`, sets `maxFeePerGas` / `maxPriorityFeePerGas` / `gas` from the override).

**Bankr / impersonator paths are exempt:** Bankr handles gas server-side; impersonator can't broadcast. The gas component handles these gracefully (picker auto-hides), but the parent should still set `isNonAtomic` correctly so the picker only fires its callbacks for PK / Seed.

## Atomic-7702 wiring (PK / Seed batch surfaces)

When a PK/SP batch resolves to `strategy === "atomic-7702"` (the dapp-batch screens flip `isNonAtomic` to `false`), `MultiTxGasEstimateDisplay` switches to "wrapped batch" mode and needs one extra prop:

- `eip7702Delegate={batchPlan.delegate}` **only when `batchPlan.needsAuthorization === true`** — triggers a state-override path in `estimateGas` that injects the delegate's runtime code at the EOA so the simulation matches post-auth chain state. When `needsAuthorization === false` the EOA is already onchain-delegated; pass `undefined` so we use plain `estimateGas` (more RPC-robust on Base public RPC and similar tiers where `stateOverride` support on `eth_estimateGas` lags behind `eth_call`).

The component additionally fires `estimateBatchGasSequential` over the inner calls in parallel as a fallback for any PK/SP batchedTx surface — handles `eth_estimateGas` binary-search divergence on deeply nested executor calldata (1inch v6 with executor, V4-with-hooks) so the "may revert" banner doesn't false-fire on batches that land cleanly. See [`7702.md` → Gas estimation](./7702.md#gas-estimation).

## Adding a NEW tx-confirmation surface

List it in the table above and make sure every gas feature here works on it before merging.

## Final-owner Safe combined action

The final unsigned native executor may choose Sign & Execute or keep Sign offchain.
The complete asset simulation waits for authority and execution-envelope
preparation, avoiding an initial approximation followed by a second pass.
The combined button keeps its dots until simulation and fee loading finish;
transport/preparation errors stop loading and retain the offchain choice.
The same GasEstimateDisplay tier, balance validity, and gas overrides are reviewed
before combined confirmation. Preparation estimates a read-only owner-sender
preview with headroom; after obtaining the real owner signature, the background
estimates the exact envelope again and refuses execution above the reviewed limit.
It passes those exact native overrides through normal Safe execution. This does
not change gas behavior on single, batch, cross-dapp, or swap/bridge surfaces.

## Safe Bunker confirmation

Bunker single Send, ERC-5792, grouped cross-dapp intents, WalletConnect and supported
same-chain swap CALLs converge on chrome/safeBunker/operations.ts. They do not use
generic EOA gas/signature handlers or ordinary Safe proposal owner selection.
Payer/gas changes invalidate the UI confirmation; background review binds the full
envelope and re-estimates exact signed execution at release. Bunker asset preview
uses Safe-owned user CALLs, with unavailable acknowledgement; rotation is checked
separately in the real signed execution. Native MAX does not reserve owner gas.
Cross-chain bridges are disabled until destination Safe/settlement support exists.

### Bunker transaction confirmations

Bunker transaction intents open a single `BunkerTransactionConfirmation` adapter
using the same `ConfirmationScreen`, requesting-app identity, estimated changes,
call list, and sticky decision region as imported Safe transactions. Fee preparation
runs automatically for the chosen payer. The shared account picker appears compactly
in the footer with the optional per-Bunker default preference; payer or fee changes
invalidate the reviewed digest before confirmation. Expired reviews need a refresh.
Unavailable asset previews retain explicit acknowledgement, while exact signed
execution simulation and all release checks remain in the background coordinator.

Incoming requests and Send/swap continuations pin the account and open its earliest
unresolved request; explicit recovery remains directly accessible. The shared
`QueueNavigation` shows request position, previous/next and reject-all only when
every request is unsigned. Later ordinary requests show a link to the earlier
request and do not prepare gas prematurely. Rejecting a request advances to the
next pending review; cold unlock resumes the same FIFO queue. Submission selects the Bunker account and returns to
Home Activity, which already projects its durable history row. Request management
retains compact pending rows, grouping/separation and security/recovery controls;
it no longer embeds transaction confirmation forms or settled transaction history.
Signed intents cannot be rejected, and exact-byte retry remains available.

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

### Bunker rejection does not wait for fee previews

Bunker confirmation tracks an action identity, so only Confirm displays execution
phases and only Reject displays Rejecting. Rejection invalidates the fee-preview
UI effect; late responses cannot replace a rejected request. The parent advances
from its local queue after the durable acknowledgement without awaiting a fresh
view read, and masks rejected IDs from any older view response.

Fee review performs public RPC work outside request/global secret-operation locks.
Seed derivation remains inside the secret-operation lock with the captured live
access guard. A latest-review claim and signing-state snapshot are checked under
the locks before committing prepared fees. Changes from rejection, confirmation,
recovery, grouping or account mutation invalidate stale reviews. Delivery flags
are excluded from that snapshot but are preserved by merging only prepared fields
into freshly loaded state. No stale review can overwrite journal changes.

Reject still refuses every signed intent. It commits rejected state and the
pending-index update first, then the trusted router replies exactly once. Result
delivery continues outside locks; completion flags merge into a fresh journal.
Reconciliation retries unpublished unsigned rejections before any chain RPC.
Unpublished rejections are retained during journal compaction. Existing optional
resultPublished/published fields supply this outbox; keys and schemas are unchanged.
