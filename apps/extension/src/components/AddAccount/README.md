# Add Account

- `../AddAccount.tsx` is the public composition root and owns account setup effects.
- `AddAccountTypeSelectionScreen.tsx` renders saved seed groups and their + Add
  actions above the new-account type chooser. The Seed phrase card opens
  `SeedPhraseSetup` directly; Back returns to this combined chooser.
- `AddAccountActionBar.tsx` owns actions for non-seed setup paths. Seed setup
  owns its own actions; the legacy biometric seed gate has no mutation button.
- `PrivateKeyAccountSection.tsx` connects private-key entry to the externally
  placed backup acknowledgment without owning persistence.
- `SeedPhraseAccountSection.tsx` presents saved seed groups and delegates
  passkey-gated derive actions back to the composition root. The root derives a
  public `safeBunkerCount` from loaded accounts; the section shows “1 safe bunker”
  or “N safe bunkers” below the regular account count, keeping the counts separate.
- `LegacyBiometricUpgradeNotice.tsx` is a presentation-only guard shown before
  private keys or seed phrases can be entered, generated, or derived with a
  signing-only legacy biometric session.
- `useLocalAccountBiometricGate.ts` projects passkey capability status and owns
  the shared inline WebAuthn step-up before mnemonic operations.
- `model/biometricGateModel.ts` contains the pure legacy-upgrade and live
  mnemonic-capability projections. V1 passkeys were never shipped; local
  pre-release records are deliberately upgrade-gated for all local setup.
- `model/mnemonicAccessCoordinator.ts` owns the testable assertion/recheck
  sequence and fails closed unless the background advertises the live mnemonic
  capability after the fresh passkey assertion.

The background remains authoritative for authentication and secret storage.
This feature only projects `getPasskeyUnlockStatus` into an early, secret-free
renderer guard and delegates navigation back to the App composition root.

Safe Bunker selects the separate `SafeBunkerDraftScreen` for local draft creation
and reveal only. It does not call onAccountAdded or enter normal signer setup.
The account-type title map lives in `model/accountTypeTitles.ts`.
