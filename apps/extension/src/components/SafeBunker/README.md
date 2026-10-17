# Safe Bunker UI

Current flow and background contract:
[_docs/SAFE_BUNKER_IMPLEMENTATION.md](../../../../../_docs/SAFE_BUNKER_IMPLEMENTATION.md).
Use shared semantic tokens/primitives. Bunker request/view DTOs contain no source
phrases, signing keys, signatures or serialized journal transactions. Phrase
import and explicit reveal retain their ordinary trusted-UI/master boundaries.

## Setup

- BunkerSetupIntro / SafeBunkerDraftScreen: info then saved phrase cards. The top
  row aligns icon/name/Proceed; known-chain logos sit below with hover/focus names.
- BunkerSourceSetup: ordinary create/import with zero implicit EOAs. Deferred backup
  and later EOA derivation use the normal phrase group/vault lifecycle.
- BunkerNetworkSetup: source name/new badge, Deploy on selector, determined-address
  loader/copy, manual Find, known deployments and explicit Add existing checkboxes.
- useBunkerDiscovery / discoveryModel / BunkerChainPills: source-bound manual probes,
  bounded workers/pages, known deployment retention and canceled late results.
  Unknown/failed chains stay selectable; actual preparation verifies separately.
- BunkerDeploymentFooter: shared payer/gas/Deploy on the network screen as soon as
  a chain is selected. Source/chain changes reset controls. No extra review screen.
- BunkerDeploymentScreen: pending deployment actions from settings only.

Find runs only on button press, including for imported/new phrases. Chain selection
hides or/Find/search response. Fully absent successful search has useful empty copy;
errors never become proof of absence. Add existing sends no tx or forced rotation.
Broadcast selects the pending Bunker and opens Activity; verification enables spending.
No Continue setup list, dedicated phrase ceremony or account-name form exists.

## Requests and payer

- app/bunkerRequestPreload / useBunkerNavigation: preload code/fresh public view
  before navigation, bind identity and reject superseded/locked/removed opens.
  Only code is cached; request/default-payer data is freshly loaded.
- BunkerAccountScreen: seeded confirmation, no duplicate mount fetch, ordered
  refreshes and local rejection masking. Unseeded/recovery entry has a fallback.
- BunkerTransactionConfirmation / requestQueue: shared ConfirmationScreen adapter,
  FIFO navigation, exact review and explicit decisions. Submitted outer effects
  leave approvals and stay in Activity; later execution waits for settlement.
- BunkerAssetPreview / BunkerRotationReview: Safe-owned user intent and exact public
  rotation metadata using the shared owner card/call rows. No derived-address guesses.
- PayerFields / usePayerBalances: one deployment/transaction account picker and
  chain-native balance renderer. Eligibility comes from safe/accountTypePolicy.
  Bounded configured RPC, chain checks and cancellation prevent stale/false-zero
  labels. Default preference uses a square amber checkbox and belongs to one Bunker.
- GasFields / GasEstimate/GasFeeLoading: existing compact fee editor and section
  loading; retain editor state through review. Payer/gas changes invalidate review.
- transport: trusted UI commands; background owns auth, provenance, fees, signing,
  durable exposure, exact retry and settlement.

The renderer stores only an explicit payer override. Otherwise it uses the
operation-bound payer or latest saved default, so refresh can hydrate selection
without undoing user choice. Remember is persisted by the worker with exact outer
bytes before broadcast. Visible balances/preferences/preload snapshots grant no
authority. Only live master sessions may perform Bunker secret/execution commands.

Reject commits before result delivery and does not wait for fee preview. Back from
unsigned settings rotation rejects that exact request; ordinary transaction Back
preserves it. Signed/submitted operations cannot be canceled through rejection.

## Settings and shared integration

BunkerSettingsScreen / useBunkerSettings own name, network, last verified owner,
refresh, normal phrase reveal, explicit rotation and guarded removal. Scroll is
restored through useScreenScrollRestoration with component-local state. There is
no request queue or gas-payer form here. BunkerRotationScreen owns recovery and
owner rotation only. Removal opens the shared AccountRemovalModal directly over
settings; both warning steps count regular and Bunker seed references.

Recovery details/export is absent. Phrase plus chain reproduces identity; Find
locates existing accounts/current owners. Removal requires only seed-backup
acknowledgment through final modal confirmation and live master access. While the
account exists, operational evidence stays encrypted for verification and retry.
Removal clears Bunker records; last-source-account removal also clears the phrase
and seed group. Normal Activity history remains.

Home reuses the ordinary pending banner/list and badge. AccountIdentity supplies
amber Safe logo plus chain badge; source name · Bunker identifies source groups
in Choose account. Account settings remains a separate route from requests.
