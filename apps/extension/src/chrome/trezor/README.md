# Trezor transport audit domain

This Chromium-only domain owns public account metadata, the Connect 10
background adapter, master-gated setup handlers, and exact signer verification.
Durable request authorization is shared with Ledger. Ledger alone uses the
hardware offscreen document.

- `connectSdk.ts` is the sole runtime SDK import, exact-pinned at 10.0.1.
- `connectAdapter.ts` initializes the webextension Suite client, rebinds the
  canonical Ethereum identity during discovery/scanning, validates input/output,
  and signs with one SDK method per operation. `signing.ts` must recover the
  exact pinned account before any effect; no address-export preflight or
  cached session authorizes signing. The adapter checks cancellation
  after every SDK await.
- `deviceBinding.ts` pins subsequent calls to transient Suite path, instance and
  wallet state; these fields never reach renderer or storage.
- `connectClient.ts` serializes operations, projects bounded status, applies
  deadlines, cancels by matching ID and drops stale results. The active slot is
  retained until upstream settles after cancellation or timeout.
- `offscreenBridge.ts` retains old imports as an export-only facade.
- `derivation.ts`, `connectValidation.ts`, and `errors.ts` own bounded paths,
  payloads and stable failures.
- `storage.ts` owns exact public codecs and atomic account/device imports.
- `accountHandlers.ts` owns trusted-UI setup; `signing.ts` independently verifies
  exact signed bytes/digests and recovered signers before final authorization.

Suite Web uses an externally connectable channel with the pinned
`@trezor/connect-common` patch. Replies require the current top-level official
approval tab and exact origin/path; outgoing requests cannot be appended after
that tab navigates elsewhere. Suite Desktop uses the official loopback socket.
Neither channel grants WalletChan wallet-UI authority. See the migration and
dependency review under `_docs/`; physical-device QA remains a release gate.
