# Keycard Shell setup UI

- `keycardShellFlowAdapter.ts` — the Keycard Shell provider for the shared
  `HardwareWallet` add-account flow. It reuses the Ledger operations, but grants
  WebHID for the Shell's USB IDs and tags connect/scan with `vendor: "keycardShell"`.
- `KeycardShellSetupScreen.tsx` — full-tab setup screen for `?route=add-keycard-shell`.

Accounts are stored as `type: "ledger"` with `vendor: "keycardShell"`; signing goes
through `chrome/ledger` and `offscreen/shellSigner.ts`.
