# Seed Phrase Setup

- `../SeedPhraseSetup.tsx` owns generated/imported mnemonic state and background effects.
- `SetupFrame.tsx` owns the onboarding-versus-extension screen shell and sticky actions.

The onboarding adapter supplies the shared `OnboardingHeader` during import;
`SetupFrame` renders only its left-aligned heading there. The import-view
callback lets the adapter hide that outer header during address selection,
which retains its own Back action to the entered phrase.

Mnemonic persistence remains delegated to the background. Presentation files do
not read storage or perform wallet operations.
