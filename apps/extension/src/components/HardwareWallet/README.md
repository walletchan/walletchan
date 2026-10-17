# Shared hardware-wallet UI

This domain owns provider-configured presentation shared by hardware wallet
features. It contains no transport, storage, Chrome messaging, account
authorization, signing, or broadcast policy.

- `types.ts` defines the local brand and derivation-option contracts.
- `AddHardwareWalletFlow.tsx` owns address paging, duplicate state, selection,
  loading, errors, sticky actions, and the provider-operation boundary.
- `HardwareWalletLogo.tsx` renders locally packaged provider marks.
- `HardwareWalletAvatar.tsx` adapts a provider mark to account-avatar slots.
- `HardwareWalletDevicePanel.tsx` presents connection state and provider copy.
  Onboarding hides its redundant section heading and description through the
  flow's `showDevicePanelHeading` presentation option.
- `HardwareWalletDerivationPicker.tsx` renders provider-owned path choices.
- `HardwareWalletSigningStatus.tsx` keeps request review mounted while a device
  operation is active.
- `HardwareWalletSetupShell.tsx` owns the shared full-tab setup frame.

Provider domains supply local assets, copy, derivation options, and operations.
Ledger and Chromium Trezor are wired through this shared UI. Trezor's full
emulator and physical-device release gates remain tracked in
[the Trezor guide](../../../../../_docs/TREZOR.md); Firefox does not expose the Trezor provider.
