# Safe Bunker implementation

This is the current product and runtime reference. Exact derivation and CREATE2
identity are specified in [SAFE_BUNKER_DERIVATION.md](./SAFE_BUNKER_DERIVATION.md).
Storage, trust boundaries and release checks remain owned by [STORAGE.md](./STORAGE.md),
[SECURITY.md](./SECURITY.md) and [PUBLISHING.md](./PUBLISHING.md).

## Account model

A Bunker is a standard Safe 1.4.1 with one owner and threshold one. Each transaction
atomically executes the user's CALLs and replaces the owner with the next derived
EOA. Owner rotation is wallet client policy; another Safe client can bypass it.
There is no custom factory, guard, owner registry, relayer or reimbursement scheme.

One source phrase has one deterministic Bunker per chain. Each chain derives
separate owner keys and a different Safe address. A Bunker account supports only
its bound chain. Renaming an account or phrase does not change its address.

The source is a normal saved seed group in the existing mnemonic vault. It may
also back ordinary EOA accounts, or have zero regular accounts. Create/import in
the Bunker flow adds no implicit EOA. Normal Add account → Seed phrase → Derive
can add one later. Backup reminders and phrase reveal use the ordinary seed flow.
No separate Bunker phrase, branch key, xpriv or agent signing capability is stored.

All Bunker management, discovery, derivation, review, signing, retry and recovery
require live master authority. Password and supported biometric master unlock
use the existing mnemonic access capability. Agent sessions cannot execute Bunker
operations. Public unsigned request intake and notification hints are separate
from this authority boundary.

## Add account

1. Add account → Safe Bunker opens the information screen, then saved seed phrases.
2. Each source card has its wallet icon, name and Proceed button on the top row.
   Known Bunker chain logos appear below, with names in hover/focus tooltips.
   They are informational. Only these source-card Proceed buttons have chevrons.
3. Users may create or import a normal phrase. Newly generated phrases use the
   existing deferred backup reminder; creation/import does not add an EOA account.
4. Proceed opens network selection. The header shows the selected phrase name;
   a phrase created or imported during this flow has a small amber superscript `new` pill.
   This marker is flow-local, not persisted or inferred from backup status.
5. `Deploy on` labels the shared network selector. Choosing a chain determines the
   Safe address and displays it with a copy button. The loader says
   `Determining Safe address…`. The hidden initial account name is
   `SafeBunker - <chainName>`; users can rename it later in account settings.
6. Once a network is selected, the same screen's footer shows
   `Pay for deployment using`, the account picker, native gas loading/estimate,
   editable fee controls and Deploy. There is no separate deployment/review page.
   Address preparation and payer-bound gas review must finish before deployment.
7. Broadcast/ambiguous submission publishes the pending account and opens its
   Home Activity immediately. Canonical activation remains required before owner
   execution; submission is not treated as confirmation.

There is no Continue setup concept. Internal source/chain preparation is not a
selectable account. Only a deployment broadcast attempt, or explicit verified
Add existing, publishes an account. Activity and reconciliation track pending
state after submission; the initial flow does not show a deployment-submitted
waiting page. Pending-deployment check/exact-retry controls remain in settings.

Bunker account avatars use the amber Safe logo and bound-chain badge. The account
picker subtitle is `<source name> · Bunker`; Send contacts label them `Bunker`.

## Find and add existing Bunkers

Discovery is manual for saved, imported and newly created sources alike. Before a
network is selected, centered `or` and `Find already deployed Bunkers` offer the
alternative action. The button owns checking progress. Selecting a network hides
this search section, including its results/error text below the button.

Source cards use public local account metadata and results already found during
the flow. Neither source selection nor source creation automatically probes chains.

The network page shows known deployments in `Already deployed on`. Verified
Bunkers missing locally appear under Add existing as checkbox rows with chain
logo/name; adding checked accounts sends no transaction. It neither forces owner
rotation nor asks for a Safe address or original deployment hash.

A successful search with every requested chain absent shows
`No bunkers found. Deploy on your desired chain`. Incomplete/failed probes do not
produce that definitive empty result. Failures have Retry. Unknown, unchecked or
failed chains remain selectable; only known deployed/pending accounts are disabled.
Selected-network preparation and submission independently verify infrastructure
and reject actual duplicates. An RPC error never becomes proof of absence.

`discovery.ts` predicts from source/chain, checks canonical configuration at a
confirmed block, and matches the current owner against local derivation in pages
of at most 64 indices. Public search progress is memory-only, expires after ten
minutes and is bound to master epoch/current owner. UI concurrency is bounded;
late results are ignored after source changes, Back, lock or unmount.

Add existing rechecks the matched owner and canonical block before activation.
It preserves known local exposure, reserved indices and operation archives. A
fresh device cannot discover unpublished signatures created elsewhere; current
owner matching alone cannot establish their absence.

## Chains and deployment

`network.ts` uses the wallet's configured chain metadata/RPC. The network list
includes visible resolved chains except zkSync Era (324); listing does not prove
compatibility. Deployment/review verify the target chain ID and exact pinned
canonical EVM Safe 1.4.1 factory, singleton and MultiSendCallOnly runtime hashes.
Missing/incompatible infrastructure fails closed. The payer uses EIP-1559.
There is no hardcoded Ethereum-Sepolia-only runtime or promise that every listed
chain works. Testnets use their own chain IDs and the shared chain-logo mapping.

`deploymentIdentity.ts` computes the standard factory initializer, salt and proxy
address. Source/chain determine identity; mutable names, payer IDs and local group
IDs do not. See the derivation reference for the frozen path, encoding and vectors.

`deployment.ts` verifies the exact factory transaction/creation event, canonical
receipt, three confirmations and full live Safe authority before activation.
`deploymentPublication.ts` persists/selects a pending account after a broadcast
attempt and repairs both Safe and payer history idempotently.

The deployment hash and exact signed deployment bytes are operational journal
state, needed for verification, exact retries, integrity and history repair.
They are not a display-only recovery-details record. Clearing Activity does not
replace or authorize deleting that state. No recovery-details screen/export or
extra public-metadata backup is required.

## Transaction requests and gas payer

Injected transactions, internal Send, ERC-5792, WalletConnect and supported
same-chain swap CALLs converge on the Bunker operation coordinator. Every route
is pinned to account, chain and contributing origin/topic. Each origin is checked
again before review/signing/release. Unsupported signatures and EOA authority
methods do not acquire a signing path.

`useBunkerNavigation` preloads UI code and a fresh public view in parallel before
navigation. `bunkerRequestPreload.ts` caches code only; public snapshots remain in
React state, are identity-checked and cleared on lock. The seeded screen renders
confirmation immediately without another mount fetch. Unseeded/settings recovery
paths retain a loading fallback. Refresh responses cannot overwrite newer reads.
Gas and asset simulation retain their own section loaders. Preloading is display
work and never an execution authorization.

Home's ordinary pending banner/list and toolbar badge expose requests. FIFO
navigation does not hide earlier unsigned requests. Submitted outer transactions
leave the approval carousel immediately and remain in Activity. A later request
can show its calls while waiting for the previous owner rotation to settle.

Deployment and transaction footers share `PayerFields`,
`RequestConfirmation/DecisionAccountSelector`, `usePayerBalances` and fee controls.
Menu rows show compact native balances for the bound network, a small loading
placeholder, or an unavailable dash. Reads use configured bounded RPC and reject
chain mismatches; stale responses are ignored. Display balances grant no authority.

Eligibility is owned by `safe/accountTypePolicy.ts`: the implemented Bunker payer
paths support private-key, seed-phrase and Ledger EOAs. Bunkers, imported Safes,
view-only and Bankr accounts cannot pay through this path. Do not infer eligibility
from general direct-signer status or add a second account-type list in React.

A square amber checkbox offers `set default payer for future` after explicitly
choosing a non-default payer. The preference is per Bunker account, not shared
across chains or all Bunkers from one phrase. The worker commits it in the existing
encrypted journal with the exact outer envelope before broadcast. The renderer
stores only a deliberate override; otherwise the operation-bound payer or latest
saved default supplies the selection. View refreshes preserve an explicit choice.
Payer/gas changes invalidate the prepared review. Source/network changes reset
creation's footer state. Confirm remains disabled until review/preview gates pass.

## Review, signing and settlement

- The canonical builder accepts at most 99 user CALLs, blocks protected authority
  targets and appends exactly one `swapOwner`. Recovery is rotation-only. The
  pinned MultiSendCallOnly envelope makes calls and rotation atomic. Inner Safe
  reimbursement is zero; the external payer pays the native outer gas.
- Review binds calls/routes, chain, live configuration, nonce, owner/successor
  indices, payer, gas, expiry and digest. Independent fee/balance reads run in
  parallel. Public RPC work runs outside long-held request/secret locks; latest
  review claims are rechecked before merging prepared fields into fresh state.
- The real inner signature is encrypted durably before any signature-bearing RPC.
  The payer envelope uses explicit reviewed gas/fees; local preparation fills
  only its nonce. Ledger approval precedes the same final gate as local signing.
- `preflight.ts` selects one fresh block and verifies chain, Safe version/singleton,
  owner/nonce/threshold/modules/guard/fallback, unused plain owner/successor EOAs,
  payer balance and one exact gas-capped `eth_call`. Confirm does not re-estimate
  gas or repeat historical deployment scans. Auth, expiry and route gates are
  checked immediately before durable outer bytes/hash and broadcast.
- Phase hints contain only correlated account/request IDs and fixed phases
  `signing`, `checking`, `broadcasting`, `submitted`. They grant no authority.
  Durable submission selects the Bunker and returns to Home Activity.
- Ambiguous outcomes retain exposure and retry identical serialized outer bytes.
  There is no automatic rebroadcast or new-signature retry. Reverts do not make
  an exposed owner safe to reuse for another intent.
- Settlement requires canonical ExecutionSuccess/hash, owner-change evidence and
  compatible live owner/nonce after three confirmations. Recent block anchors
  detect reorgs; unresolved exposure requires recovery. External nonrotating
  Safe transactions may advance nonce without advancing the owner index.

Unsigned rejection commits state/index before the UI acknowledgment; delivery
runs afterward and retries from durable publication flags. Rejection does not
wait for stalled fee RPC, and late review responses cannot resurrect the request.
Signed intents cannot be dismissed as safely canceled. Back from unsigned owner
rotation rejects that exact request; ordinary transaction Back preserves it.

## Activity, settings and recovery

Deployment and execution appear in both the Safe and gas-payer histories. Safe
Activity presents user intent, shared decoded calls, native/token changes and
public owner-rotation metadata. Raw signatures, initializer and serialized outer
transactions never enter public history. The Safe's native balance delta does not
charge/refund gas paid by the external EOA. Receipt enrichment and reconciliation
repair missing projections idempotently.

Account settings owns name editing, network, last verified zero-based owner index,
refresh, phrase reveal, Rotate owner and guarded removal. It contains no request
queue or standalone recovery-details/export page. Rotate owner requires an active
verified deployment and master session. Recovery status appears only when needed.

Manual recovery reads the current owner and matches locally derived owners in
bounded pages, without a genesis/event-history scan. If ownership changes during
a scan, the search restarts for the new owner. Full configuration is checked again
before activation. Known exposure is retained; `exposureUnknown` requires a
confirmed explicit rotation before ordinary spending. Add existing does not itself
create that requirement. Recovery cannot cancel another already signed transaction.

Removal uses the same two-step AccountRemovalModal as regular accounts, directly
over settings. It has no separate Bunker removal screen, backup checkbox or extra
password field. Final confirmation acknowledges the backup warning; the existing
live master session remains required. It refuses the last account and
unresolved requests/transactions, disconnects mapped sites, repairs selection,
then deletes the Bunker binding/journal and account atomically. A sync-quota
failure preserves identity for retry. Shared cleanup counts regular and Bunker
accounts together: regular-account confirmation uses account-only warnings while
a Bunker still references the phrase. The last removal deletes the seed group, encrypted phrase and
remaining Bunker preparations/archives for that source. Other accounts preserve
the phrase. Normal Activity history remains. Re-import uses onchain discovery and
current-owner matching; deleted offchain signer-exposure records cannot be recovered.
Reset refuses unresolved exposure or submitted unactivated deployments.

The Already deployed on header and saved-source chain logos use only stored
wallet accounts. Discovery results remain separate until Add selected accounts
succeeds; going back never promotes search results to saved-account indicators.

Discovery results appear directly below Find already deployed Bunkers, with the
Add existing heading, selectable network list and Add selected accounts action.
The whole result row toggles its checkbox, including row padding. Checked boxes
use the shared amber commitment variant; selecting a deployment network hides
this search/result section.

## Source map and validation

Background audit order is in
[`chrome/safeBunker/README.md`](../apps/extension/src/chrome/safeBunker/README.md).
UI owners are in
[`components/SafeBunker/README.md`](../apps/extension/src/components/SafeBunker/README.md).
Test coverage is in
[`tests/safeBunker/README.md`](../apps/extension/tests/safeBunker/README.md).

Useful checks, from `apps/extension`:

```sh
pnpm exec tsx --test tests/safeBunker/*.test.ts
pnpm exec tsx --test tests/ui/bunker*.test.ts tests/ui/architecture.test.ts tests/ui/moduleSizeBudget.test.ts
pnpm typecheck
```

Integration tests require `anvil` and use disposable loopback chains with synthetic
keys/funds and verified upstream runtimes. They cover separate chain IDs 11155111
and 84532, deployment/rotation, persistence, history, owner discovery, recovery and
failure handling. They do not establish public-network acceptance. UI tests cover
manual discovery, default-payer hydration and request preloading/cancellation.
Real Chrome acceptance is assigned to the user; physical Ledger QA needs a device.
Do not claim those passed from typechecks or synthetic tests. Source changes also
require the full root `pnpm build:extension` before Chrome reload.

This checkout implements no Trezor payer path. Bankr execution, provider message/
typed-data signing, EOA delegation/permissions, Shield, sponsorship/force inclusion
and cross-chain bridges are unsupported for Bunkers. Shared-phrase support has no
reader/migration for the incompatible dedicated-phrase alpha; ordinary released
wallet data must remain preserved. No formal post-quantum guarantee or protection
from a compromised phrase, instant ECDSA break or external unpublished signatures
is claimed.
