# Shared hardware transport audit domain

This domain owns only lifecycle coordination for the single Chromium hardware
offscreen document.

- `offscreenManager.ts` serializes document creation, counts concurrent Ledger
  requests, prevents one request from closing the document while another is
  active, and closes it after the shared idle deadline.
- Keycard Shell (`offscreen/shellSigner.ts`) reuses the Ledger account type,
  bridge and offscreen handler; `LedgerAccount.vendor` routes it. Its tx `v`
  (and message/typed-data `v`) is only a hint: signing accepts the parity that
  recovers to the pinned account. Cancel is routed to the signer that owns the
  active operation. Force inclusion is off for Shell accounts until device QA.
- Provider-specific SDK calls, account policy, storage, signing, and error
  handling remain in their Ledger or Trezor domains.
- The offscreen listener independently authorizes the exact service-worker
  sender before the Ledger handler runs. Trezor Connect runs in the background worker.

Mirrored concurrency and architecture coverage lives in
`tests/hardware/README.md`.
