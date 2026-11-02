# Lattice tests

No-device coverage for the Lattice1 protocol port in
`src/chrome/lattice/protocol/`.

- `protocolParity.test.ts`, `txPreimageParity.test.ts`, `calldataParity.test.ts`
  check byte parity with `fixtures/apeGridParity.json`. That file is copied from
  ape-grid-lattice `tests/fixtures/fixtures.json`, which its `generate.js`
  produces with the npm libraries gridplus-sdk uses (crc-32, aes-js, elliptic,
  @ethereumjs/rlp).
- `sdkParity.test.ts` checks ETH_MSG requests byte for byte against
  `fixtures/gridplusSdkEthMsg.json`: the exact sign envelopes the real
  gridplus-sdk 4.0.0 `Client` sent to the simulator. Regenerate with
  `tools/lattice-sdk-parity` (repo root). EIP-712 cases stay TODO until the
  typed-data encoder lands.
- `personalSign.test.ts` checks the personal_sign layout and size limits.
- `client.test.ts` drives the client against `fakeLattice.ts`, an in-process
  simulator that speaks the real wire protocol: CRC-checked frames, ECDH and
  AES-256-CBC, ephemeral-key rotation, P-256 pairing-signature checks,
  EXTRA_DATA reassembly, prehash detection and secp256k1 signing.
- `transport.test.ts` covers the relay request shape and endpoint validation.
- `phase1Domain.test.ts` runs the background domain (setup, pairing, scanned-only
  commit, encrypted pairing key, vault integrity, signing recovery, SafeCard,
  lost pairing, locked wallet, offline relay, busy and cancel) against the
  simulator through `relayFetch.ts`, plus the exact account codec.
- `router.test.ts` and `uiWiring.test.ts` cover the message manifest, audience
  and the UI's use of the shared hardware flow.

Run:

    npx tsx --test --test-concurrency=1 tests/lattice/*.test.ts

Real-device check (read-only unless a signing flag is passed; never broadcasts):

    npx tsx scripts/lattice-device-smoke.ts --ape-grid
    npx tsx scripts/lattice-device-smoke.ts --ape-grid --sign-message "hello" --sign-tx
