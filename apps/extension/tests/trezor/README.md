# Trezor transport tests

No-device tests cover Connect 10 package/manifest placement, exact Suite reply
origin/tab/frame/path and outbound navigation checks against the installed
patched SDK, transient device/wallet bindings, cancellation/deadlines and late
results, canonical identity, released paths, public storage codecs, capability
exclusions, bounded responses, exact serialization and signer recovery.

The full extension security suite exercises existing local, Ledger, Bankr,
Trezor, Safe, view-only, auth, request and WalletConnect boundaries. These tests
do not replace packaged Suite/emulator or representative physical-device QA.
Current emulator setup, observed smoke coverage and remaining release gates
are in [the Trezor guide](../../../../_docs/TREZOR.md). Clear-signing metadata
is not implemented.
