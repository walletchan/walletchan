# Signed message history

- `model.ts`: pure exact signing projection, digest, source/kind and filters.
- `types.ts`: versioned public entries and encrypted database envelopes.
- `schema.ts`: additive signature-store/index creation during the shared v4 upgrade.
- `database.ts`: IndexedDB signature/account stores, idempotent writes, retention and reset.
- `repository.ts`: unlocked-session encryption/decryption, row identity binding and notifications.
- `export.ts`: validated filters and explicit transaction/Safe export projections.

High-level signature release and internal authorization owners call this domain.
Low-level cryptographic primitives never log attempts. No returned signature bytes,
passwords, API keys, HD paths, device IDs, or session credentials enter this store.
The general vault key encrypts signed content and shared account metadata.
`signatureAccounts` stores one encrypted `{id,address,type}` record per account ID.
Individual signature payloads contain an account ID reference, not an address/type
copy. The public envelope holds ID, account reference, owner address, timestamp
and byte accounting for indexing/retention. Reads verify encrypted ID/reference/time
and the shared encrypted account ID/address against the public envelope. API entries
are hydrated into the existing shape; no UI/signing caller needs a schema change.
Account metadata is decrypted once per account in each history read.
An unavailable database or key prevents releasing a new signature without a record.
Release authority is checked again after durable recording; denied releases remove
the provisional row. Signing/authorization is distinct from delivery or execution.

The store retains at most 10,000 entries / 25 MiB of encrypted envelopes, with
768 KiB maximum plaintext per entry. The budget counts shared metadata once. Oldest entries are removed first; orphan
account metadata is deleted atomically on pruning, discard and clear. State
retains recording start and prune count. Explicit clear preserves coverage state;
wallet reset clears all three signature stores. Transaction history clearing does not touch these
stores. Password changes rewrap the same general vault key and need no history rewrite.

Coverage: injected and WalletConnect personal-sign/EIP-712 requests across all
five direct signers; linked-owner Safe approvals; sponsored ERC-3009 transfers;
ERC-7715 grants; and token-paid gas UserOperations. Transaction-envelope and
EIP-7702 authorization signatures remain represented by transaction history,
not duplicate message rows. Remote agent operations created outside WalletChan
are not observable here. No previous off-chain signatures can be backfilled.

Tests: history encryption/database/export tests and the all-signer signature
confirmation regression. Real Ledger/Trezor signing still requires device QA.

The v4 database upgrade creates the account store. Local development records
have been normalized; the temporary conversion module and UI route are removed.
