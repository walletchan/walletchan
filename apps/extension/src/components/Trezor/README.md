# Trezor UI adapter

- `AddTrezorFlow.tsx` binds the Trezor provider to the shared hardware-wallet
  account controller.
- `trezorFlowAdapter.ts` owns trusted WalletChan message effects and public
  status projection.
- `trezorBrand.ts` and `trezorDerivation.ts` own provider configuration.
- `TrezorSetupScreen.tsx` composes the shared full-tab shell.
- `TrezorLogo.tsx`, `TrezorAvatar.tsx`, and `TrezorSigningStatus.tsx` are thin
  compatibility adapters over shared presentation.

No Trezor SDK code executes in the renderer. Matching behavior is covered by
`tests/trezor/` and shared UI architecture tests.
