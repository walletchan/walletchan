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

## Where WalletChan differs from gridplus-sdk, and why

Compared with `gridplus-sdk` 4.0.0. Everything not listed here sends the
same bytes as the SDK. The tests named below live in
`apps/extension/tests/lattice/`.

### Request bytes

A test pins each difference, so a fixture regeneration that changes one
fails loudly.

- **Functions with fixed `bytesN` parameters get no calldata decoder.** The
  SDK sizes a `bytesN` parameter as N / 8, so `bytes32` becomes 4. On
  firmware 0.18.9 the device then showed only the last 4 bytes of a
  `bytes32` argument (a `grantRole` role showed as `0x1c89…`). With size 32
  the device refused the decoder. A truncated value on the device screen
  misleads the signer, so WalletChan sends no decoder and the device shows
  the raw calldata. Test: `sdkParity.test.ts`, "is refused for fixed
  bytesN", 4 of the 14 decoders.
- **EIP-712 data the device cannot show as fields signs as two hashes.** For
  a type with more than 36 fields, or a payload over the frame limit, the
  SDK sends only the final EIP-712 digest. WalletChan sends
  `0x1901 || domainSeparator || messageHash` through generic signing, so the
  device shows the domain separator and the message hash, as a Ledger does
  when blind signing. WalletChan uses this one fallback for every EIP-712
  request the device cannot show as fields (see Behaviour). Both paths sign
  the same digest. Test: `sdkParity.test.ts`, "falls back to hashes where
  gridplus-sdk prehashes", 2 of the 9 EIP-712 cases.
- **A dynamic `bytes` value of `0x00` is sent as that byte.** The SDK sends
  it as empty bytes. The device builds the EIP-712 hash from the fields it
  receives, so it would sign different data from the dapp's request.
  WalletChan sends the real byte. Test: `client.test.ts`, the Safe `SafeTx`
  case with `data: "0x00"`.

### Behaviour

- **Fallbacks instead of errors.** When the device answers `INVALID_MSG` to
  an EIP-712 request, or the data has a shape the firmware lacks (for
  example an array of arrays), WalletChan signs the two hashes above. When
  the device refuses a calldata decoder, WalletChan sends the same
  transaction again without it. The SDK returns the error. Neither fallback
  runs after the user rejects on the device.
- **Decoder sources.** The SDK's `fetchCalldataDecoder` asks Etherscan, then
  4byte.directory. WalletChan reuses the sources it already has: the
  verified ABI from `fetchContractAbi` (Sourcify, with proxy resolution),
  then the Sourcify and 4byte.directory selector lookups. It keeps a decoder
  only when re-encoding the decoded arguments reproduces the calldata
  exactly, and gives up after 5 seconds. So the port adds no service or API
  key, and a decoder that does not fit the calldata never reaches the
  device.
- **Wrong active wallet.** WalletChan pins each Lattice device record to the
  wallet it was added from (internal or SafeCard), and refuses to sign while
  another wallet is active. On a wrong-wallet reply the SDK fetches the
  active wallet and retries, which signs with whichever wallet is active.
- **Retries.** Both wait 3 seconds and retry when the device is busy, and
  reconnect when the ephemeral key is stale. The SDK retries up to 3 times;
  WalletChan up to 2.
- **No stored session.** The SDK `Client` keeps the ephemeral key, firmware
  version and active wallet between calls, and can save that state for
  reuse. WalletChan keeps only the encrypted app key and connects at the
  start of every operation, because an MV3 service worker can stop at any
  time. The cost is one extra relay round trip per operation.
- **Firmware 0.15.0 or newer.** The SDK still supports older firmware
  through its legacy signing paths. WalletChan rejects older firmware at
  connect and uses only generic signing and `ETH_MSG`.
- **Extra signature checks.** Both recover y-parity against the device's
  public key from a locally computed hash. WalletChan also rejects high-s
  signatures, and rejects a device-reported digest that differs from the
  local one.

### Same bytes, different implementation

The SDK's crypto comes from npm libraries. WalletChan uses WebCrypto for
P-256 (key generation, ECDH, the pairing signature) and AES-CBC, and viem for
keccak, sha256, RLP and secp256k1 recovery. `protocolParity.test.ts` checks
the ECDH secret, the pairing signature and the DER encoding against
OpenSSL.

## What this tool does not compare

The tool captures `ETH_MSG` requests (personal_sign and EIP-712) and calldata
decoder definitions only. Transaction preimages, generic signing requests,
connect, pairing, address requests and the encrypted framing are checked
against ape-grid-lattice's fixtures (`fixtures/apeGridParity.json`, read by
`protocolParity.test.ts`) and on a real device (`_docs/LATTICE.md`), not
against the SDK `Client`. Extending `generate.ts` to those requests would
close that gap.
