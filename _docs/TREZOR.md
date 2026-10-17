# Trezor integration

Trezor accounts use exact-pinned `@trezor/connect-web@10.0.1` in the Chromium
background worker. Trezor Suite Web or Suite Desktop owns device selection,
PIN/passphrase entry and device approval. Desktop installation is optional.
Firefox does not expose or bundle the Trezor transport.

## Architecture and security

- `chrome/trezor/connectSdk.ts` is the sole runtime SDK import.
  `connectAdapter.ts` uses `env: "webextension"`, `coreMode: "auto"` and debug off.
  The additional foreground-proxy package is not used.
- Setup/scanning exports and checks the canonical address at
  `m/44'/60'/0'/0/0`; subsequent calls in that operation carry a transient
  device/path/instance/wallet-state binding. Address pages use the bundle API.
- Transaction, personal-message and typed-data signing each make one SDK call
  at the stored derivation path. They do not re-export accounts before signing
  or reuse a cached Suite session as authority. Suite selects the wallet;
  WalletChan verifies exact serialized transaction bytes or message/digest and
  recovers the pinned account before broadcast, Safe publication or signature
  release. A wrong wallet can reach device approval but its result is rejected.
- `connectClient.ts` serializes opaque operation IDs, scopes cancellation to
  the active operation and applies 90-second discovery/ten-minute signing
  deadlines. Cancellation rejects promptly, drops late results and retains the
  slot until upstream settles. Retry uses a fresh operation ID.
- Only public account metadata is stored: `accounts` adds `deviceId`, `hdPath`
  and `hdIndex`; `trezorDevices` contains label/model/time keyed by canonical
  public address. No SDK transport/session state, PIN, passphrase or private
  material is persisted. No storage migration is required.
- Ordinary signing supports master and agent sessions. Account import/removal
  is master-gated; an agent never gains private-key/seed reveal capability.
  Durable request, origin/topic, nonce, account/path and reset checks still run
  at the final effect boundary.
- Suite Web uses an external reply channel restricted to the official origin.
  The pinned `connect-common` patch checks active tab, top frame, exact origin
  and approval path, message size and outbound tab URL. That listener grants no
  WalletChan UI/provider authority. Suite Desktop uses its official loopback
  connection. Suite owns its own release and privacy behavior.
- Ledger alone uses the authenticated hardware offscreen document. Firefox
  resolves Trezor authority modules to a fail-closed stub and packaging rejects
  transport leakage. Existing artifact cleanup and forbidden-marker guards
  deliberately prevent stale transport files from entering a release.

See [implementation](./IMPLEMENTATION.md#trezor-architecture),
[security](./SECURITY.md), [storage](./STORAGE.md) and
[the dependency/patch audit](./TREZOR_DEPENDENCY_REVIEW.md).

## Supported scope

Supported: legacy/EIP-1559 transactions, custom EVM networks, personal messages,
validated EIP-712, custom nonce/replacement transactions, WalletConnect's
reduced method set, Safe owner approvals/native-gas execution and single
Privacy Pools transactions.

Rejected by capability/background policy: raw `eth_sign`, EIP-2930-only
transactions, ERC-5792/cross-dapp batching, EIP-7702, ERC-7715, token-funded fees,
sponsored transfers, force inclusion, direct in-extension swap/bridge,
Privacy Pools multi-exit and approval-cleanup mutations. A new SDK capability
does not automatically enable a WalletChan feature. Trezor on-device
clear-signing metadata/descriptors remain future work.

## Local emulator and connection

The separate test environment is at
`/Users/apoorvlathey/blockchain/wchan/trezor-user-env`. The current local setup
uses Safe 5 (`T3T1`) Universal firmware `2.12.5-arm` with Bridge `3.2.1`.

- Dashboard: http://localhost:9002/
- Device display: http://localhost:6080/vnc_embed.html
- Controller WebSocket: `ws://localhost:9001`
- Bridge: local ports `21325` and `21328`

Keep emulator testing in a dedicated browser profile with a disposable test
wallet and no real recovery phrase or funds. Suite may reject emulator device
or firmware authenticity. Suite's **Settings → Device → Danger area** provides
separate device-check and firmware-authenticity opt-outs for development. Keep
those checks enabled when using physical devices. Do not weaken WalletChan's
production origin checks to work around an emulator warning.

Initialize the emulator, load the unpacked extension from
`apps/extension/build/`, then open **Add Account → Trezor → Connect**. Approve
public-address export in Suite, select addresses and import them. During
signing, Suite and the simulated device handle the signing approval; no
WalletChan address-export preflight runs. Close expired approval tabs before
retrying a timed-out request. Check for another local Bridge/Suite instance if
transport access conflicts.

A local development Suite plus Connect Explorer is an alternative test setup;
starting local Suite alone does not redirect this extension's production
approval endpoint. See the [official emulator guide](https://docs.trezor.io/trezor-firmware/core/emulator/index.html)
and [Suite settings](https://trezor.io/guides/trezor-suite/trezor-suite-settings).

## Validation and release gates

Current evidence (2026-10-16):

- Full Chrome build, extension typecheck and focused adapter lint passed after
  the signing/export-prompt fix. Security regression: 2,486 passed, one existing
  skip, zero failures. Tests cover single-call cold/repeated signing, wrong
  wallet with forged address metadata, exact bytes/digests, cancellation,
  stale results and discovery identity checks.
- The SDK migration also passed Firefox build/transport-exclusion packaging
  and a frozen install preserving unrelated dependency resolutions.
- The user confirmed the updated emulator flow works after the repeated export
  prompt fix. This confirms that smoke flow; it is not completion of the full
  emulator or physical-device matrix below.

Before release, record model, firmware, browser/OS, account/path, operation,
expected/actual result and display limitations for each applicable case:

| Area | Required scenarios |
| --- | --- |
| Setup/accounts | Connect, model metadata, first/next address pages, all released path schemes, multi-import, duplicates, rename/switch, remove last device account, reset and onboarding rollback. |
| PIN/passphrase | PIN enabled, standard and hidden wallets, changed passphrase, no PIN/passphrase exposure to WalletChan. |
| Transactions | Legacy and EIP-1559 transfer, contract call/deployment, edited gas/nonce, Speed Up/Cancel, rejection, disconnect, timeout and malformed responses. |
| Signatures | UTF-8/hex personal messages, simple/nested/array EIP-712, chain/size/schema rejection, wrong signer/digest and hash-only display limitations. |
| Concurrency/lifecycle | Competing surfaces/actions, busy SDK, close wallet/Suite during approval, worker restart before/after signing, browser restart with pending request, cancellation and stale result rejection. |
| WalletConnect | Session approval, transaction/personal/EIP-712, unsupported methods omitted, disconnect and durable result replay. |
| Safe | Owner approval, wrong owner/hidden wallet, threshold-ready native-gas execution and token-gas rejection. |
| Privacy Pools | Shield, receiver-paid Unshield, single public exit, multi-exit rejection and intent mutation during approval. |
| Cross-wallet regression | Private key, seed phrase, Ledger, Trezor and Bankr signing/auth; master/agent policy, view-only rejection and linked Safe-owner authority. |
| Distribution | Chrome/Firefox manifests and bundles, fixed budgets, dependency/license/patch review, no emulator hooks or remote extension code, fresh store archives/hashes and accurate privacy disclosures. |

Physical-device acceptance remains required: at least one Model One and a
current touchscreen model; stable Chrome on macOS and a second supported
desktop OS; standard/hidden wallets; transaction, personal/EIP-712, Safe
owner/native execution and a Privacy Pools transaction. Emulator results do
not validate physical connection, display, touch/buttons or browser/OS behavior.
Record Suite Web/Desktop coverage separately. Follow [publishing](./PUBLISHING.md)
for release PRs, store artifacts and source/license requirements.
