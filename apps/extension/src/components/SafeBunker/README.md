# Safe Bunker UI

- `BunkerSetupIntro`, `BunkerSetupTabs`, `SafeBunkerDraftScreen`: illustrated intro, shared-style Create/Restore modes and idempotent preparation that opens deployment directly. No saved-setup list is shown; the account is published pending after broadcast, while execution requires verified deployment.
- `BunkerDeploymentScreen`: account identity/address, footer deployment payer using the shared compact decision-account selector, automatic gas estimation with the shared footer loader/editable fees, direct Deploy-to-Activity and optional shared recovery-phrase backup. Stale payer estimates are discarded; failed estimates can retry.
- `BunkerDeploymentScreen`: deterministic Safe address, payer, native gas review,
  deploy/status/exact retry. Account publication opens Activity immediately; execution activation waits for verified confirmations.
- `BunkerAccountScreen`: request-only confirmation coordinator. No settings or queue list.
- `BunkerSettingsScreen`: settings identity/name, public Bunker details, refresh,
  recovery tools and guarded removal. No request queue or gas payer controls.
- `useBunkerSettings`: public view reads, storage refresh, action-specific busy/error
  state and existing background mutations.
- `BunkerRecoveryDetails`: compact Safe-address pill, network and deployment rows;
  shared advanced disclosure for derivation metadata and a fixed public-details copy action.
- `BunkerSensitiveAction`: focused recovery review/scan and removal destinations;
  removal resets backup acknowledgement on exit and uses live master-session authorization without a password field. The removal button opens a themed confirmation modal with account identity; only its final action dispatches removal, and Cancel/Escape leave the account intact.
- `BunkerTransactionConfirmation`: shared confirmation composition, call decoding,
  asset preview, payer/fee footer, exact review/Confirm and durable retry.
- `BunkerAssetPreview`: shared Safe-owned asset preview; explicit unavailable
  acknowledgement. Background checks the signed execution and rotation separately.
- `BunkerRestoreScreen`: phrase/public details/master proof and paged recovery.
- `PayerFields`, `GasFields`: shared eligible executor policy and fee controls.
  Payer selection reuses SafeOwnerAccountPicker and the shared avatar/identity
  account rows, with Bunker-specific labels and the existing default checkbox.
- `client`, `transport`: trusted UI commands. No signing key or signed journal DTO.

App composes a lazy Bunker surface; the shared Home pending banner/list and badge expose requests; `useBunkerNavigation` handles
pinned incoming/cold-start requests. Send keeps the existing transfer form. Signing,
provenance, gas validity and persistence belong to `chrome/safeBunker`, not React.
Use the existing semantic theme primitives and concise copy; no setup essay.

Transaction intents now render individually through `BunkerTransactionConfirmation`
using the shared Safe/EOA confirmation composition. Account settings owns recovery and removal; requests stay in the Home pending
banner and standard confirmation. Confirmed history belongs to Home Activity. The footer owns payer selection/default preference and automatically
prepares a digest-bound review. Actual signing, simulation, persistence and retry
continue through the existing background commands.

`requestQueue` keeps incoming notifications on the oldest pending operation and
allows explicit recovery. Shared `QueueNavigation` exposes earlier/later requests;
only wholly unsigned queues offer Reject all. Reject advances to the next request.
Later ordinary requests cannot prepare fees before their predecessor settles.

Incoming requests use the shared transaction skeleton during load. Home uses the shared pending banner/list and toolbar badge; account-picker Settings opens BunkerSettingsScreen. No permanent Bunker Home rail remains.

Compact request payers use the shared `RequestConfirmation/DecisionAccountSelector`
anchored menu, not the setup picker. Only an explicitly selected non-default payer
shows “set default payer for future”; selection clears that checkbox. Fee review
expiry refreshes automatically while idle and errors offer Retry.

Fee preparation renders the shared `GasEstimate/GasFeeLoading` row used by single
and batch confirmations. The animated loader replaces the fee row while preparing;
the fee editor stays mounted so its tier/custom state survives re-review.

The compact default-payer checkbox uses the shared `commitment` amber variant,
24px row height, secondary small text and no added gap below the account row.

Back from an unsigned owner-rotation review durably rejects that exact request,
including settings-initiated loading, before returning. It uses the same
rejection claim/error handling as Reject; signed/submitted operations are never
rejected by Back. Ordinary dapp transaction Back still preserves its request.

`BunkerRotationReview` renders exact prepared public owner metadata in a shared
OwnerRotationCard and two semantic action rows. `shared/OwnerRotationCard` is also
used by Activity details. Projection adds no signer secrets or persisted shape.

BunkerRestoreScreen reuses live master authorization, checking it before submission. Expired authorization uses the shared UnlockScreen; agent sessions are blocked and no restore is replayed after unlock. Lock clears phrase state and invalidates late UI results.

`restoreProgress.ts` drives bounded restore scan pages sequentially while the screen is mounted and master-authorized. Normal restore has one action and a status screen, without tabs or raw scan counters. Errors pause for explicit Retry; Back/unmount or authorization loss stops future pages and suppresses late UI results.
