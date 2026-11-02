# Lattice hardware-wallet domain

This domain owns GridPlus Lattice1 accounts: the relay protocol client, setup
and pairing, the encrypted pairing key, public device metadata, and
Lattice-specific transaction/message signing. Signing keys stay on the device.

- `protocol/` is a stateless TypeScript port of the Lattice1 wire protocol
  (see its README). It has no storage, session, or Chrome dependencies.
- `operations.ts` runs one cancellable device operation at a time in the
  service worker, emits `latticeStatus` messages, and owns the in-memory setup
  session (pairing key, verified wallet identity, scanned addresses).
  `withLatticeAccount` reconnects for every signing step and requires a paired
  response with the pinned wallet UID.
- `accountHandlers.ts` validates trusted-wallet-UI requests. Account import is
  master-only and takes relay, wallet and path facts from the setup session;
  only addresses read from the device during that setup are accepted.
- `storage.ts` commits accounts, the public `latticeDevices` row and, for a
  first pairing, the encrypted key in one write; removal drops the device row
  and the key with the last Lattice account.
- `appKeyRecord.ts` holds pure, session-free key-record helpers used by vault
  integrity; `appKeyVault.ts` loads the key with the cached general vault key.
- `codecs.ts` exact-decodes persisted Lattice account rows.
- `signing.ts` prepares unsigned payloads, recovers every signature to the
  pinned account, and broadcasts exact serialized bytes. EIP-712 is signed as
  domain/message hashes in phase 1.
- `session.ts`, `errors.ts`, `derivation.ts` hold session restoration, the
  user-facing error vocabulary, and the released derivation schemes.

Shared lifecycles live in `ledger/transactionExecution.ts` and
`ledger/signatureConfirmation.ts` under the `"lattice"` provider.
