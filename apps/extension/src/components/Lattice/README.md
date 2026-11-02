# Lattice UI

- `hardwareSetupRoute.ts` maps `index.html?route=add-lattice` to the full-tab
  Lattice setup.
- `AddLatticeFlow.tsx` wraps the shared `components/HardwareWallet/` flow with a
  connection form (device ID, optional self-hosted endpoint) and a pairing-code
  prompt that appears only when the Lattice requests pairing.
- `latticeFlowAdapter.ts` owns Lattice status subscription and the connect,
  pair, scan, cancel and import messages. Import sends only chosen addresses.
- `latticeDerivation.ts` lists the offered derivation schemes.
- `latticeBrand.ts` configures neutral, font-free marks packaged with
  WalletChan (not GridPlus artwork).
- `LatticeLogo.tsx`, `LatticeAvatar.tsx`, `LatticeSigningStatus.tsx` and
  `LatticeSetupScreen.tsx` are provider adapters over the shared hardware
  presentation components.
