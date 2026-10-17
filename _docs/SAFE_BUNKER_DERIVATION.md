# Shared-phrase Bunker derivation and deployment identity

Format: derivation v2, deployment v2. This is the current frozen identity
specification used by deployment, discovery, execution and recovery. See
[SAFE_BUNKER_IMPLEMENTATION.md](./SAFE_BUNKER_IMPLEMENTATION.md) for the runtime
and user flow.
All source access requires master authority. No alpha fallback/migration.

## Source phrase and owner path

Use the ordinary wallet mnemonic policy (currently canonical 12-word English
BIP39) and existing mnemonic-vault authorization. These helpers neither generate
nor save another phrase. Never expose their private-key callback through a
message route. Public path/owner output is not an execution authorization.

Every path component is hardened:

```
m/44'/60'/1464027214'/2'/chainHigh'/chainLow'/ownerIndex'
```

- `1464027214` is `0x5743484e` (ASCII WCHN), the WalletChan-specific account
  namespace. It is not a newly registered BIP purpose or coin type.
- `2` is the frozen Bunker derivation version.
- Chain IDs must be numbers satisfying `Number.isSafeInteger(chainId)` and
  `chainId > 0`. This matches the wallet's numeric chain-ID representation.
  Strings, bigint inputs, fractions and numbers above 2^53 - 1 are rejected,
  never coerced, truncated, hashed to one component or silently rounded.
- `chainHigh = floor(chainId / 2^31)` and `chainLow = chainId mod 2^31`.
  Always include both, including a zero high component. The pair losslessly
  covers the entire supported chain-ID range and cannot alias through modulo.
- `ownerIndex` is an integer from 0 through 2^31 - 1. Exhaustion rejects; no wrap.
- Owner zero initializes the Safe. Later indices belong to that chain's journal;
  Safe nonce, ordinary EOA derivation index and another chain's indices are not
  substitutes for the owner index.

This namespace differs from ordinary EOA derivation `m/44'/60'/0'/0/index`
and the alpha `m/44'/60'/0'/0'/index'`. Fully hardened child derivation prevents
public child derivation from an ancestor xpub. No xpub/chain code is exported or
persisted. It does not protect any account from a compromised source phrase.

`chainIdentity.ts` owns public selectors/path formatting. `chainOwnerDerivation.ts`
owns scoped background derivation. It reuses `mnemonic/derivation.ts` validation,
wipes intermediate HD private buffers, root and mutable BIP39 seed bytes in
finally paths, and does not cache keys. Private-key hex strings passed to signing
cannot be reliably erased by JavaScript. Auth/session checks are the caller's
responsibility and must surround future asynchronous source access/signing.

## Frozen public vectors

Published BIP39 vector: eleven `abandon` words followed by `about`. These are
public test data, never user recovery material. Independently computed with
ethers HDNodeWallet and checked against scure derivation:

| Chain ID | Owner index | Owner address |
| --- | --- | --- |
| 1 | 0 | `0xfd4188ec55e5efa1a0b2c7255c297c8f59c773ea` |
| 11155111 | 0 | `0x71af960bbdec82837766ecfa486b55734fbbf706` |
| 84532 | 0 | `0x6d6de14eb38807a1537b47c9f150065e452a2c44` |
| 84532 | 1 | `0xf7b8bf04e1b47c7c2f080fb1d6a8a75e9a4e1790` |
| 2147483648 | 0 | `0xe44d58423db7b502267ea067792acdae29225a4f` |
| 9007199254740991 | 2147483647 | `0x3b92599b853d9d859871053d7e9297729dea5423` |

## Frozen deployment salt

`deploymentIdentity.ts` defines:

```
domain = keccak256(UTF8("WalletChan.SafeBunker.shared-seed"))
saltNonce = uint256(keccak256(abi.encode(
  bytes32 domain,
  uint256 deploymentVersion = 2,
  uint256 derivationVersion = 2,
  uint256 chainId,
  address initialOwner
)))
```

The same phrase/chain reproduces this value after reimport on another device.
Local source-group ID, random setup ID, name, payer, timestamp and current
rotating owner are excluded. Addresses are validated and normalized before use;
zero owner/factory/singleton addresses are rejected.

Use standard Safe 1.4.1 initialization: `[initialOwner]`, threshold one, zero
setup target, empty setup data, zero fallback handler, zero payment token,
zero payment and zero payment receiver. The deployment identity contains exact
initializer, factory calldata, decimal salt nonce, source chain, versions,
initial owner, factory/singleton, proxy creation-code hash and predicted address.
Its stable local account key is `bunker:<chainId>:<lowercaseSafeAddress>`.

Standard factory address calculation remains unchanged:

```
factorySalt = keccak256(keccak256(initializer) || uint256(saltNonce))
initCode = proxyCreationCode || abi.encode(address singleton)
address = last20(keccak256(0xff || factory || factorySalt || keccak256(initCode)))
```

`abi.encode(address singleton)` occupies the same 32-byte word as the standard
factory's `uint256(uint160(singleton))`. Proxy creation code must be nonempty,
even-length hex and at most 4096 bytes. This bound is not a code identity check.

The caller must supply a separately verified canonical chain profile. This pure
module does not resolve infrastructure, probe RPC, validate runtime hashes,
activate an account or prove that a supplied owner was derived from a phrase.
`network.ts` and the deployment coordinator supply those checks and reject
caller-provided owner/profile overrides.
A matching address is not proof of current Safe configuration or deployment
finality. Do not silently change the profile/version to work around failures.

## Evidence and reproduction

`tests/safeBunker/chainIdentity.test.ts` checks fixed independent owner vectors,
lossless chain encoding, separation from EOA/alpha paths, callback failures,
invalid selectors and the independent ethers factory calculation.
`chainDeployment.integration.test.ts` runs separate disposable Anvil instances
with chain IDs 11155111 and 84532 and hash-checked upstream Safe 1.4.1 factory/
singleton runtimes. It verifies factory simulation and actual deployment match
prediction, canonical proxy runtime, expected sole owner, threshold one, zero
Safe nonce, singleton identity, deterministic reimport and duplicate rejection.
No user profile, real network, funded-chain broadcast or owner signature is used.

From `apps/extension`:

```sh
pnpm exec tsx --test tests/safeBunker/chainIdentity.test.ts tests/safeBunker/chainDeployment.integration.test.ts
```

These identity tests are complemented by the full Bunker runtime and UI suites.
Synthetic chain checks do not establish live RPC availability, hardware behavior
or acceptance on every visible network. See the implementation reference for
validation boundaries and the full extension build requirement.
