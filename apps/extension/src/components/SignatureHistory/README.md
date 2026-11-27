# Signature history UI

- `ActivityHistory.tsx` composes the existing public transaction ledger and the
  Signatures view; transaction state stays mounted across filter changes.
- `SignatureHistoryList.tsx` reuses ListSurface/ListItem and ActivityDateHeader,
  groups dates and opens an accessible detail dialog with bounded display paging.
- `SignatureDetails.tsx` leads with app/date and resolved network,
  then scrollable signed content. The shared InlineDisclosure holds technical
  metadata; only the exact payload and digest have copy controls. Account identity/type
  stay out of this per-account view, and Source appears only for WalletConnect
  and internal requests.
  React escapes all supplied content; the modal owns focus and dismissal.
- `presentation.ts` owns pure labels, origin display and UTF-8 message decoding.
- `useSignatureHistory.ts` owns trusted Chrome messages, notifications and stale
  response suppression. No signing/storage authority lives in the renderer.
- `ActivityExportSettings.tsx` owns Settings filters, JSON download and Blob URL cleanup.

The feature uses existing Warm Midnight/Bauhaus tokens, system component recipes,
compact rows, native input controls, and modal focus handling. No new fonts,
palette, shadows or animation. Settings routes here through its Data group.

`useActivityView.ts` resets the selected view when leaving Activity. The parent
portfolio places `ActivityViewMenu.tsx` at the right edge of its existing network
filter row and passes the chosen view to `ActivityHistory`. Signature empty states
show the title only; export coverage remains in Settings.

The Activity overflow trigger opens the shared compact `ActionSheet`, matching
Assets. Selection closes the bottom drawer and restores focus to the trigger;
current-view emphasis stays on the shared selection checkmark.
