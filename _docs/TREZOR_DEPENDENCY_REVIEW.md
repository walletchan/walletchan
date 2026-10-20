# Trezor Connect dependency review

Reviewed 2026-10-16 for Connect 10 migration. Lock authority: `pnpm-lock.yaml`.
Current architecture and release acceptance are tracked in [TREZOR.md](./TREZOR.md).

## Provenance and execution

- Exact production root: `@trezor/connect-web@10.0.1` (MIT package metadata).
- Registry integrity:
  `sha512-xoVHBWiO4XAVV8B/6uk5WS91LAb7OEy6p3tCIO78RxxyqSF+CEJz4ofXM3xY9l4d4Rz1VBMOtONBSuhwG/O/kQ==`.
- Published commit: `2ee7bd0636889196bab33e6069e2736393a58f3c`.
- Entrypoint: official ESM `lib/index.js`, imported only by the background
  `chrome/trezor/connectSdk.ts`. No runtime script downloads or copied Connect
  protocol implementation. `env: webextension`, `coreMode: auto`, debug off.
- `@trezor/connect-webextension` is intentionally not used: its foreground
  proxy registers an additional callable SDK surface. WalletChan exposes only
  its existing trusted setup/signing routes.
- Connect 10 is a thin client. Suite owns core execution, device selection,
  PIN/passphrase interaction and device approval. Updating the bundled SDK does
  not pin Suite Web or Suite Desktop releases or their privacy behavior.

## Frozen package closure

`pnpm --filter @walletchan/extension list --prod --depth Infinity --json`
contains **19 unique name/version pairs** reachable from the selected root. Its direct dependencies are
`@trezor/connect-common@10.0.1`, `@trezor/utils@10.0.1`,
`@trezor/websocket-client@10.0.1` and `tslib@2.8.1`. The lockfile is the full
machine-readable graph, including the exact dependency patch hash.

Published license metadata: 16 MIT, one 0BSD, one Apache-2.0 AND BSD-3-Clause,
and one `SEE LICENSE IN LICENSE.md` (`@trezor/crypto-utils@10.0.1`). The latter
omits that referenced license from its tarball and source package directory.
Do not infer redistribution permission for it. The thin client's production
bundle tree-shakes its unused re-export completely; the background build now
fails if any `@trezor/crypto-utils` module has nonzero rendered code. A future
SDK that retains it requires an explicit license review before distribution.
The SDK's MIT notice is retained in `THIRD_PARTY_NOTICES.md`.

`bufferutil@4.1.0` and `utf-8-validate@5.0.10` declare optional
`node-gyp-build` install scripts. Installation used `--ignore-scripts`.
These Node-only WebSocket accelerators are not executed by the browser client.
No new native hardware transport or USB implementation is bundled; Suite owns
that transport. No transitive prerelease version is present.

## External channel patch

`patches/@trezor__connect-common@10.0.1.patch` hardens the official
`ServiceWorkerWindowExtConnectableChannel` without replacing its protocol:

- Replies require the current approval tab ID, top frame, exact sender origin,
  exact `/web/connect-popup` path, no URL credentials and a 2,100,000-character
  serialized message ceiling, in addition to upstream UUID/channel checks.
- Outgoing requests recheck that tab's current origin/path before appending the
  request fragment; navigation to another page fails closed.
- Tests import the **installed patched** module and reject other Suite tabs,
  frames, missing sender fields, oversized messages and navigated destinations.

Chrome's `externally_connectable.matches` permits only
`https://suite.trezor.io/*`. No Trezor content-script relay or USB-permission
wrapper is packaged. The SDK listener
cannot invoke WalletChan's wallet-UI/provider message handlers. Review/rebase
this patch on every Connect update; do not silently drop it.

## Network, privacy and artifact boundaries

- Suite Web approval: `https://suite.trezor.io/web/connect-popup`. Public account
  paths, addresses, reviewed transactions/messages/typed data and app manifest
  pass to Suite as needed for approval. No WalletChan password, private key,
  recovery phrase, vault/API key, PIN or passphrase is supplied by WalletChan.
- Suite Desktop: `ws://127.0.0.1:21335/connect-ws`, selected by the official auto
  client when available. Local transport discovery is delegated to Suite.
- Debugging is disabled. No WalletChan analytics initialization is added; the
  reviewed background contains no `data.trezor.io/connect/log` endpoint. This
  does not assert that Suite itself never uses analytics or remote services.
- Build guards reject SDK dynamic-function/eval markers and retained
  crypto-utils code. The current Chrome background passes the existing fixed
  4.25 MiB combined Safe Bunker/Trezor budget. Ledger's offscreen document contains no Trezor SDK.
- Firefox aliases authority-bearing Trezor modules to a fail-closed stub;
  packaging rejects Suite/WebSocket/Trezor transport markers and removes
  Chrome-only Trezor assets. No Firefox Trezor support is claimed.

## Acceptance boundary

No-device regressions cover input/output validation, device/wallet drift,
canonical identity, wrong signer/path/serialized bytes, exact cancellation,
timeouts, concurrent calls, stale results and the installed external channel.
Chrome/Firefox build and full wallet regression results are recorded in
[TREZOR.md](./TREZOR.md).
Representative physical-device QA remains required before release.

Sources: [published package](https://www.npmjs.com/package/@trezor/connect-web/v/10.0.1),
[exact SDK MIT license](https://github.com/trezor/trezor-suite/blob/2ee7bd0636889196bab33e6069e2736393a58f3c/packages/connect-web/LICENSE.md),
and the installed package sources and pinned lockfile.
