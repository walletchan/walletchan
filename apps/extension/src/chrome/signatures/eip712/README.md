# EIP-712 signature policy audit domain

- `validator.ts` owns bounded parsing, required envelope fields, type/field
  count caps, raw ERC-7710 rejection, and validation ordering.
- `delegationPolicy.ts` identifies raw ERC-7710 `Delegation` typed data that
  must use WalletChan's reviewed execution-permission flow instead.
- `accountDomainPolicy.ts` rejects external account-domain signatures using
  caller-supplied protected addresses; it performs no storage or RPC reads.
- `schemaValidation.ts` owns prototype-safe identifiers, type references,
  circular references, schema depth, and iterative object depth checks.
  Namespaced structs use the ordinary validation rules, including nested references.
- `sanitization.ts` projects domain/message values onto declared schema fields
  before display and signing.
- `types.ts` owns the shared validation result contract.
- `diagnostics.ts` formats bounded validation reasons and caller-owned schema
  context for injected/WalletConnect rejections without message values or wallet state.

All modules are pure and must remain independent from Chrome, sessions,
accounts, credentials, signing, transport, and storage. The root
`eip712Validator.ts` file is only a stable policy-free re-export facade.

The viem dependency patch in `patches/viem@2.45.1.patch` preserves exact names
and resolves only own type definitions when collecting hashing dependencies.
The validator does not duplicate or compensate for encoder behavior.
