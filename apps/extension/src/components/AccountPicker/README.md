# Account Picker

`AccountPickerScreen.tsx` owns the shared searchable, reorderable account list
used by the public-home account switcher and Settings → Accounts. Its explicit
`select` mode delegates row activation to account switching; `manage` mode
delegates the same row activation to account settings and never changes the
active account. The parent owns navigation, add-account routing, and refreshed
account state.

The home switcher portals through FullScreenPickerLayer. That layer uses native
inert for the covered app, without aria-hidden on its still-focused trigger.
AccountSwitcher restores trigger focus after the closed picker has unmounted;
Add account and Settings deliberately retain their destination's focus handling.
