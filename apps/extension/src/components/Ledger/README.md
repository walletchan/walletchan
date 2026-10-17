# Ledger UI

- `app/ledgerSetupRoute.ts` opens `index.html?route=add-ledger` in a full tab
  when Ledger is selected from the popup or side panel, then closes the
  originating side panel.
- `AddLedgerFlow.tsx` preserves the public Ledger flow API while delegating
  paging, selection, duplicate state, loading, and layout to the shared flow.
- `ledgerFlowAdapter.ts` owns the explicit WebHID chooser gesture, Ledger
  status subscription, device discovery, scan, and account-import messages.
- `ledgerDerivation.ts` owns Ledger's released derivation schemes and order.
- `ledgerBrand.ts` configures Ledger's locally packaged official marks for the
  shared `components/HardwareWallet/` presentation domain.
- `LedgerLogo.tsx`, `LedgerAvatar.tsx`, `LedgerDevicePanel.tsx`,
  `LedgerDerivationPicker.tsx`, `LedgerSigningStatus.tsx`, and
  `LedgerSetupScreen.tsx` are provider-specific adapters over those shared
  hardware components. They preserve Ledger's existing public imports and
  exact copy while making layout reusable.
- `LedgerSigningStatus.tsx` configures the shared sticky signing notice with the
  official lettermark on its black brand tile and a trailing progress spinner while
  transaction/signature screens keep their request content mounted and locked
  through hardware approval. The primary action uses the shared three-dot
  loader and the transaction broadcast status stays hidden until device signing
  has finished.

The service worker remains authoritative for authentication, account commits,
request pinning, signing, and broadcast. Renderer messages contain only public
device metadata, derivation paths, addresses, and unsigned payloads.
