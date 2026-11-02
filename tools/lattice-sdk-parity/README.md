# Lattice SDK parity fixtures (dev only)

WalletChan's Lattice support is a TypeScript port of the Lattice1 protocol. It
does not ship gridplus-sdk (see `_docs/LATTICE.md`). This folder keeps the SDK
as a pinned reference so the port can be checked against the SDK's real bytes.

`generate.ts` runs the real `gridplus-sdk` `Client` against WalletChan's Lattice
simulator (`apps/extension/tests/lattice/fakeLattice.ts`) through a stubbed
`fetch` that speaks the GridPlus relay format. The simulator records each
ETH_MSG sign request exactly as received, and the script writes them to
`apps/extension/tests/lattice/fixtures/gridplusSdkEthMsg.json`.
`apps/extension/tests/lattice/sdkParity.test.ts` then requires WalletChan's
encoders to produce the same bytes.

The normal test suite reads only the committed fixture file; it never needs
this folder installed.

## Regenerate

```
cd tools/lattice-sdk-parity
npm ci --ignore-scripts
npm run generate
```

Run it after changing a case in `generate.ts`, or when moving the pin in
`package.json`. Review the fixture diff before committing it.

## Boundaries

- Outside the pnpm workspace (`pnpm-workspace.yaml` lists packages
  explicitly), so nothing here enters the extension build or `pnpm-lock.yaml`.
- `gridplus-sdk` is pinned exactly; `package-lock.json` pins its tree.
- Install with `--ignore-scripts`. The SDK only runs locally, against the
  simulator; the stubbed `fetch` rejects every other URL.
