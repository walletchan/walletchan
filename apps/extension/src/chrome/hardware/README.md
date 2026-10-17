# Shared hardware transport audit domain

This domain owns only lifecycle coordination for the single Chromium hardware
offscreen document.

- `offscreenManager.ts` serializes document creation, counts concurrent Ledger
  requests, prevents one request from closing the document while another is
  active, and closes it after the shared idle deadline.
- Provider-specific SDK calls, account policy, storage, signing, and error
  handling remain in their Ledger or Trezor domains.
- The offscreen listener independently authorizes the exact service-worker
  sender before the Ledger handler runs. Trezor Connect runs in the background worker.

Mirrored concurrency and architecture coverage lives in
`tests/hardware/README.md`.
