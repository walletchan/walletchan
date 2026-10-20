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

## Safe Bunker

The required Safe4337Module configuration, self-funded native/ERC-20 execution,
payer defaults and module-required v3 deployments are specified in
[SAFE_BUNKER_4337.md](./SAFE_BUNKER_4337.md). That specification supersedes
the older no-module/external-payer-only descriptions below.
 confirmation

See [SAFE_BUNKER_IMPLEMENTATION.md](./SAFE_BUNKER_IMPLEMENTATION.md) for the
current flow, coordinator and settlement rules. Bunker requests use
BunkerTransactionConfirmation as an adapter to the shared ConfirmationScreen;
they do not become ordinary imported-Safe proposals or generic EOA signing prompts.

- Navigation preloads UI code and a fresh public view together. Confirmation opens
  with that view; gas and asset simulation have section loaders. An unseeded or
  settings-recovery entry may still use the shared initial loading fallback.
- Internal Send, injected, ERC-5792, WalletConnect, grouped intents and supported
  same-chain swap CALLs converge on safeBunker/operations.ts. Cross-chain bridges
  and unsupported signature/EOA-authority methods have no Bunker execution path.
- Deployment and transaction footers share PayerFields, DecisionAccountSelector,
  native-balance reads, GasFeeLoading and compact editable fee controls. Menu
  balances use the request's chain; failed reads show a dash, never a false zero.
- Payer eligibility comes from safe/accountTypePolicy.ts. Bunkers, imported Safes,
  view-only and Bankr records cannot be execution payers here. Actual implemented
  payer paths are private-key, seed-phrase, Ledger and Trezor.
- A square amber checkbox offers a default payer for this Bunker account only.
  Explicit selection clears the unsaved checkbox. The worker commits a remembered
  preference with the outer envelope before broadcast. UI refresh hydrates a saved
  default only when no deliberate override exists; operation-bound payers win.
- An unavailable asset preview uses the shared informational simulation warning
  from ordinary transaction confirmation. It requires no acknowledgment checkbox
  and does not block Confirm; exact execution preflight still runs before broadcast.
- Payer/gas changes invalidate review. Review binds exact calls/provenance,
  chain/configuration/nonce, owner/successor indices, payer, gas, digest and expiry.
  Idle expiration refreshes review; failures offer Retry. No preview authorizes
  signing. Native MAX uses the Safe balance without reserving externally paid gas.
- Confirm derives/signs only with live master authority, persists the Safe signature
  before signed RPC, signs the external payer envelope, then performs one fresh
  block-pinned authority check and exact gas-capped simulation. Reviewed gas/fees
  cannot be silently replaced. Ledger/Trezor approval precedes the same final gate.
- Fixed phase hints show Signing / Checking / Broadcasting for the exact request.
  Submission selects the Bunker and opens Activity immediately. Submitted outer
  transactions leave approval navigation; a later request waits for prior rotation
  settlement. Phase hints and preloaded snapshots grant no authority.
- Reject is available only for unsigned intents and commits before result delivery,
  independently of stalled fee preview. Late review responses cannot restore it.
  Back from unsigned settings owner rotation rejects that exact intent; ordinary
  transaction Back preserves it. Signed/ambiguous effects require exact retry or
  exposure-aware recovery, never a new signature hidden behind Retry.

Owner-rotation review uses the shared old/new owner card and Remove owner / Set
owner rows from exact prepared metadata. The Safe-owned user-call asset preview
can require an explicit unavailable acknowledgment; background simulation checks
both calls and rotation. Errors expose only fixed policy/step diagnostics, never
signed calldata, transport URLs, credentials or raw RPC errors.

Creation uses the same network-selection page through deployment. Selecting a
network reveals Pay for deployment using and Deploy, plus automatic payer-bound
fees; there is no separate deployment/review screen. Pending deployment management
remains in settings. Add existing is verification/account-add only, with no fee
payer, transaction or forced recovery rotation.
## RPC review retry

Single transaction requests place Retry beside footer errors and unavailable
asset previews for every account type. Retry checks the request is still pending,
refreshes review data, and requires a fresh Confirm click after loading. It never
recreates or broadcasts a consumed request. View-only accounts retain their
existing reject-only policy outside explicitly enabled developer RPC mode.

The shared single and multi-transaction gas controls also expose read-only Retry
on gas-estimation errors across single, batch, cross-dapp, swap/bridge, and Safe
execution reviews. Loading reports invalid gas until estimation completes;
read-only/submitting surfaces disable Retry. Existing fee-token quote Retry
continues through the quote owner.
