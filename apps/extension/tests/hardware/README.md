# Shared hardware transport tests

`offscreenManager.test.ts` proves that concurrent Ledger work creates
one hardware document, does not tear it down while any request is active,
and schedules one idle close after the final request completes. Trezor Connect 10 runs in the background instead. Provider
authorization and operation tests remain in `tests/ledger/` and
`tests/trezor/`.
