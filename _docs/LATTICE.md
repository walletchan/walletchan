# GridPlus Lattice1 integration (private fork)

Status (2026-11-02): phase 0 (protocol port) and phase 1 (account type)
committed on branch `lattice`. Real-device QA passed on 2026-11-02 for the
protocol layer and for the built extension's setup and signing flows (below).

Templates:

- **WalletChan integration:** the Ledger account type. Each Ledger file gets a
  Lattice counterpart; see the file map in the assessment
  (`Live_Sim_Mix/docs/walletchan_lattice_assessment.md`).
- **Lattice protocol:** ape-grid-lattice, ported to TypeScript in
  `apps/extension/src/chrome/lattice/protocol/` (module README maps each file).

## Phase 0: protocol port

- Pure TypeScript. Crypto from `@noble/curves` 1.9.1 (exact pin, the same copy
  viem already uses), WebCrypto AES-CBC and viem. No gridplus-sdk dependency.
  The SDK stays a pinned, dev-only reference in `tools/lattice-sdk-parity/`,
  outside the pnpm workspace: it captures the SDK's real request bytes as test
  fixtures, which the normal suite reads without installing the SDK.
- Relay default `GRIDPLUS_LATTICE_RELAY_URL` in `constants/externalUrls.ts`.
  The transport also accepts a self-hosted Lattice Connect endpoint
  (`http://<host>:8080`).
- Stateless: callers supply the P-256 app key; the ephemeral key stays in
  memory and each operation starts with `connect()`.
- Fail-closed signing helpers in `protocol/evm.ts`: the local keccak digest is
  the authority, a different device digest is rejected, high-s is rejected,
  and y-parity is recovered against the device public key.
- Firmware below 0.15.0 is rejected at connect.

Tests: `apps/extension/tests/lattice/` (see its README).

Verification (2026-10-20): 51 tests pass; typecheck, lint, the external-URL
guard and all build stages pass.

Real device (2026-11-02, firmware 0.18.9, SafeCard active, GridPlus relay),
via `scripts/lattice-device-smoke.ts --ape-grid --pair --sign-message ... --sign-tx`:

| Check | Result |
| --- | --- |
| Pairing with the on-screen code | pass |
| Addresses at `m/44'/60'/0'/0/0` and `/1` vs ape_grid's saved accounts | match |
| `personal_sign` recovered signer | match |
| EIP-1559 Sepolia transaction recovered signer (not broadcast) | match |

The device run found one bug. A paired CONNECT reply carries 144 bytes of
encrypted wallet info (two 71-byte descriptors, AES-padded), and the decoder
required exactly 160. gridplus-sdk 4.0.0 and ape_grid both slice "up to 160",
so they never noticed. The decoder now accepts 144 to 160 block-aligned bytes,
and the simulator sends 144 like the device.

Built extension (2026-11-02, Chrome, unpacked `build/` from `982662e7`): Add
Account, Lattice tile, device ID, pairing code, then the account at
`m/44'/60'/0'/0/0`. A localhost test page drove dapp requests against a local
anvil chain (31337) so no real network was touched. Each result was checked
outside the wallet (`cast wallet verify`, viem `recoverTypedDataAddress`,
`cast receipt`).

| Request | Result |
| --- | --- |
| `eth_requestAccounts` | Lattice account returned |
| `wallet_addEthereumChain` + switch to 31337 | ok |
| `personal_sign` | signer recovers to the account |
| `eth_signTypedData_v4` (hash-only on device) | signer recovers to the account |
| `eth_sendTransaction` 0.001 ETH to self | mined: EIP-1559, chain 31337, nonce 0, status 1 |

Observations from the run:

- Pairing the extension's key appears to have removed the older pairing of
  ape_grid's key, which the smoke script had paired under the same app name
  ("WalletChan"). The Lattice likely keeps one pairing per app name. Not yet
  confirmed.
- Once, the page's provider chain flipped from 31337 back to 8453 (Base)
  between the switch and the typed-data request, so intake rejected the
  domain chain. This happens before any Lattice code runs. A second run with
  `chainChanged` logging saw no flip.
- The account list on the setup screen stalled once on "Standard" paths; the
  cause is not known yet.

Bundle budget: WalletChan pins the background bundle at 4,194,304 bytes
(`privacy-prover.budgets.json`, `tests/privacy/protocolManifest.test.ts`). With
phase 1 the bundle was 4,194,124 bytes, 180 under.

Whitespace compaction (2026-11-02): upstream's syntax-only Terser pass ran in
`renderChunk`, and Vite 5's esbuild transpile pass runs after every plugin
`renderChunk` with `minifyWhitespace: false`, so it re-indented the output.
`compactGeneratedBackground` now runs in `generateBundle`, after that pass,
with the same options (`compress: false`, `mangle: false`, no comments). The
Chrome background drops to 3,635,230 bytes on one line, 559,074 under the
unchanged budget. It is byte-identical to the previous build put through the
same Terser options, so only whitespace changed. This is an upstream bug fix
worth its own pull request. Getting there took: WebCrypto
instead of `@noble/ciphers`, sharing Ledger's prepare-sign-broadcast, session
and argument helpers, a shared Safe hardware branch, and shorter messages.
Phase 2 adds code, so it needs an upstream decision on the budget.

Tooling notes: pnpm comes from corepack (`corepack pnpm`); nested package
scripts need a `pnpm` shim on PATH. Do not run `pnpm add` or a non-frozen
`pnpm install`: pnpm 9.0.0 re-resolves unrelated peers. Add lockfile importer
entries by hand and validate with `pnpm install --frozen-lockfile`.

## Phase 1: account type (built)

Follows the Ledger integration file for file; see `IMPLEMENTATION.md`
("Lattice Architecture") and `SECURITY.md` invariant 3b.

- Model and policy: `LatticeAccount`, rows in `accounts/accountTypePolicy.ts`,
  `hardware/accountCapabilities.ts` and `safe/accountTypePolicy.ts`; exact
  account codec in `lattice/codecs.ts`.
- Background: `lattice/{operations,signing,storage,appKeyVault,appKeyRecord,
  accountHandlers,session,errors,derivation}.ts`, `background/latticeRouter.ts`,
  `"lattice"` in the shared hardware transaction and signature lifecycles, Safe
  owner approval and execution, removal, replacement, reset manifest, and
  general-key integrity.
- UI: `components/Lattice/*` over the shared hardware flow (device ID form,
  optional connection endpoint, pairing-code prompt), `add-lattice` setup route,
  account grid tile, avatars, signing status, and confirmation branches.
- Tests: `tests/lattice/` (protocol parity, simulator client, background
  domain with the relay fetch stub, router, UI wiring) plus Lattice cases in the
  existing account, Safe, router, reset-manifest and message-policy tests.

## Not yet at Ledger parity

Closed 2026-11-02: `personal_sign` now goes over the `ETH_MSG` request
(schema 3, protocol `signPersonal`), ported from gridplus-sdk 4.0.0
`buildPersonalSignRequest`. The device adds the EIP-191 prefix and shows ASCII
messages as text; other bytes show as hex. Messages above 2,968 bytes are
prehashed. The reply is a DER signature plus the 20-byte signer, and the
signature must recover to that signer from the local EIP-191 digest. Phase 1
had sent the prefixed bytes through generic signing, which the device showed
as hex (`0x1945…`).

Closed 2026-11-02: EIP-712 fields on the device (`ETH_MSG` `typedData`,
byte-identical to gridplus-sdk on 7 cases, M3 and M4 showed their fields on
the device). Data the device cannot show as fields (nested arrays, more than
36 fields in a type, over 3,040 bytes, or an `INVALID_MSG` answer) signs as
domain and message hashes, never after a user rejection.

Closed 2026-11-02: contract calls decoded on the device. `calldataDecoder.ts`
reuses WalletChan's own sources unchanged: `fetchContractAbi` (verified ABI,
with Sourcify's proxy resolution; the device shows parameter names), then the
Sourcify and 4byte.directory selector lookups the history view already makes
(`#1`-style labels), then raw data. A function is used only when re-encoding
its decoded arguments reproduces the calldata exactly. Decoders match
gridplus-sdk byte for byte (14 canonical, 6 JSON-ABI, tuples included), with
one exception: functions with fixed `bytesN` parameters get no decoder. With
the SDK's size N / 8 the device showed only the last 4 bytes of a bytes32
argument; with size 32 it refused the decoder. A decoder the device refuses is
dropped and the same transaction is re-sent without it. The device shows
amounts as raw integers; WalletChan's review screen formats them.

Closed 2026-11-02: single force inclusion on OP Stack and Arbitrum. Lattice
is `"raw"` in the core policy and `forceInclusion: true` in the capability row,
with a factory in `RAW_FORCE_INCLUSION_SIGNERS` beside Ledger's, the same
shape and authority checks (account, device and path re-checked around every
device prompt; no wallet lock held while the device waits). Tests:
`tests/lattice/forceInclusionSigner.test.ts`, the twin of Ledger's.

Closed 2026-11-02: Privacy Pools single transactions. The capability row now
equals Ledger's apart from `signingTransport`. `lattice` sits beside `trezor`
at every Privacy Pools and Shield type check (stored-record validators,
operation summaries, ragequit preparation and submission, recovery and
unshield models, source picker label). Public exits stay one deposit per
transaction, as for Ledger. `tests/lattice/privacyPools.test.ts` checks the
release policies, the one-per-transaction rule against a software-wallet
control, and that no Privacy Pools or Shield file accepts Trezor without
Lattice.

Scope rule (2026-11-02): add Lattice support without changing how WalletChan
works. New code lives in `src/chrome/lattice/`; shared files get Lattice
branches only where Ledger has one. Dropped for that reason: device hashes in
the review UI (Ledger has no such UI).

| Gap | Plan |
| --- | --- |
| Built-in staking direct path | Add a Lattice branch next to `swaps/ledgerDirect.ts` |
| Onboarding step | Add Lattice to the first-account onboarding flow |
| Real-device QA | Phase 1 core, messages, EIP-712 fields and decoded calls passed 2026-11-02; run the full matrix below after the items above |

## Real-device test matrix

`AGENTS.md` requires real-device QA for hardware signers, and the
account-type checklist in `IMPLEMENTATION.md` adds Safe owner approval and
execution. This matrix is the checklist for every Lattice QA session. Ledger
parity needs every row except the "phase 3" rows to pass in one session on one
build.

### Setup for a session

1. Build the extension stage by stage (see Tooling notes above) and load
   `apps/extension/build` unpacked in Chrome. Turn off any store copy of
   WalletChan in the same profile. After every rebuild, click the extension's
   reload arrow at `chrome://extensions` and refresh the QA page: Chrome keeps
   running the old background code until then.
2. Start a local chain and fund the Lattice account from an anvil test account.
   Keep it running for the whole session; with its RPC down, WalletChan moved
   the page back to Ethereum.

   ```
   anvil --port 8563 --chain-id 31337
   cast send --rpc-url http://127.0.0.1:8563 --unlocked \
     --from 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 <lattice address> --value 1ether
   ```

3. Serve the QA page: `npx tsx scripts/lattice-qa.ts`, then open
   http://localhost:8564. Its buttons carry the M and T row IDs below.
4. After the session, run `npx tsx scripts/lattice-qa.ts --verify`. It
   recovers every signature and reads every transaction from the chain,
   independent of the wallet's own checks.
5. Record each row's result, plus what the Lattice screen showed, in the
   results log at the end.

Record once per session: date, build commit, firmware, active wallet
(internal or SafeCard), relay (GridPlus or self-hosted), browser.

### S: setup and device

| ID | Steps | Pass |
| --- | --- | --- |
| S1 | Add Account, Lattice tile, device ID, pairing code from the device | Account added; device label shows SafeCard or internal correctly |
| S2 | Load addresses for each scheme: Standard, Ledger Live, Legacy MEW | Lists load; first five match `scripts/lattice-device-smoke.ts --path <scheme path>` |
| S3 | Repeat S1 with no SafeCard inserted (internal wallet) | Account pinned to the internal wallet |
| S4 | Add a SafeCard account, swap or remove the card, then sign | Fails closed: "Insert this account's SafeCard." No signature |
| S5 | Set a self-hosted Lattice Connect endpoint, then add and sign once | Works with no request to signing.gridpl.us |
| S6 | Lock the Lattice, then request a signature | Clear "Unlock your Lattice." error; works after unlock |
| S7 | Power off the Lattice, then request a signature | Relay timeout reported, no hang; works after power-on |
| S8 | Remove WalletChan's pairing on the device, then sign | Clear "not paired" error. No re-pair button exists yet; record whether removing and re-adding the account recovers |
| S9 | Pair a second app key (another browser or ape_grid), then sign from both | Record whether both pairings survive (open question: one pairing per app name?) |

### M: messages (QA page)

| ID | Request | Pass |
| --- | --- | --- |
| M1 | `personal_sign`, UTF-8 text | Signer recovers; device shows the text |
| M2 | `personal_sign`, non-UTF-8 bytes | Signer recovers; device shows hex |
| M3 | `eth_signTypedData_v4`, flat struct | Signer recovers. Phase 1: device shows domain and message hashes. Phase 2: device shows the fields |
| M4 | `eth_signTypedData_v4`, nested struct (Permit2 `PermitSingle`) | As M3, including the nested `details` fields in phase 2 |
| M5 | Reject M1 on the device | Dapp gets code 4001; no retry prompt |
| M6 | M3 with the wallet on another chain | Rejected before the device: domain chain must match |

### T: transactions (QA page, local chain)

| ID | Request | Pass |
| --- | --- | --- |
| T1 | EIP-1559 send to self, 0.001 ETH | Mined, type 2, signer = account |
| T2 | Legacy request (`gasPrice`) | Mined; record the type WalletChan chose. On chain 31337 it sent EIP-1559, so the device's legacy path needs a chain without EIP-1559 |
| T3 | EIP-2930 request (`gasPrice` + `accessList`) | As T2 |
| T4 | 2,000 bytes of calldata | Mined; the request used an extra frame. WalletChan may warn "likely to fail" although the chain estimates 53,000 gas; proceed |
| T5 | 4,000 bytes of calldata | Mined; device shows a digest. Phase 2: the review screen shows the same digest |
| T6 | ERC-20 `transfer(address,uint256)` calldata | Mined; device shows `transfer` with the recipient and amount |
| T12 | `grantRole(bytes32,address)` calldata | Mined; device shows raw data (fixed `bytesN` functions get no decoder) |
| T13 | Uniswap SwapRouter02 `exactInputSingle` (tuple) | Mined; device shows the function and the tuple's seven fields |
| T7 | Reject T1 on the device | Dapp gets code 4001; nothing broadcast |
| T8 | Send from the wallet's own Send screen | Mined |
| T9 | Custom nonce on a send | Mined with that nonce |
| T10 | Speed up a pending send (start anvil with `--no-mining`, then `cast rpc evm_mine`) | Replacement mined, original dropped |
| T11 | Cancel a pending send (as T10) | Zero-value self-send mined at the same nonce |

### C: channels and sessions

| ID | Steps | Pass |
| --- | --- | --- |
| C1 | WalletConnect dapp: `personal_sign` and a send | Both succeed through the Lattice |
| C2 | Agent session (agent password): M1 and T1 | Both succeed |
| C3 | Stop the service worker mid-session (`chrome://serviceworker-internals`), then sign | Reconnects and signs |

### F: Safe

Use a Safe on Sepolia or a mainnet fork with the Lattice account as an owner.

| ID | Steps | Pass |
| --- | --- | --- |
| F1 | Approve a Safe proposal with the Lattice owner | Confirmation recorded for the right `safeTxHash`. Phase 2: device shows SafeTx fields |
| F2 | Execute a Safe transaction, native gas, with the Lattice owner | Executed |

### L: lifecycle

| ID | Steps | Pass |
| --- | --- | --- |
| L1 | Remove the last Lattice account | `latticeAppKeyVault` and `latticeDevices` entries go with it |
| L2 | Wallet reset | Pairing key and device rows cleared |
| L3 | Change or remove the password or passkey, then sign | Pairing survives; signing works |

### P: phase 2 parity features

| ID | Steps | Pass |
| --- | --- | --- |
| P1 | Force inclusion on an OP Stack chain | One device approval; inclusion completes |
| P2 | Force inclusion on Arbitrum | Child then parent approvals; reject each once and retry |
| P3 | Privacy Pools single transaction | Signs and completes |
| P4 | Built-in staking direct path | Signs and completes |
| P5 | Onboarding with a Lattice as the first account | Completes without another account type |

### B: browsers (phase 3, optional)

| ID | Steps | Pass |
| --- | --- | --- |
| B1 | Firefox build: S1, M1, T1 | Work over the relay with no offscreen document |

### Results log

| Date | Build | Firmware, wallet | Rows passed | Notes |
| --- | --- | --- | --- | --- |
| 2026-11-02 | `982662e7` | 0.18.9, SafeCard | S1, M1, M3 (hash-only), T1 | Run with an earlier version of the QA page. M1 showed hex on the device. S2 stalled once on Standard, then loaded. Smoke script also passed: pairing, addresses, `personal_sign`, EIP-1559 |
| 2026-11-02 | EIP-712 and calldata commits | 0.18.9, SafeCard | M3 and M4 (fields on device), T6 and T13 (decoded), T12 | M4 prompted twice once: a stuck request survived an extension reload and arrived late; both prompts showed the same fields. T12 first showed `0x1c89…`, the last 4 bytes of the bytes32 role (SDK size rule); with size 32 the device refused the decoder and the fallback signed raw data. Fixed `bytesN` functions now get no decoder |
| 2026-11-02 | `ETH_MSG` commit | 0.18.9, SafeCard | M1 (text on device), M2, M3 and M4 (hash-only), T1 to T6 | `--verify` passed all ten rows. M1 first ran before the extension reload and showed `0x1945…`; after the reload the device showed the text. T2 and T3 went out as EIP-1559. T4 drew a false "likely to fail" warning. T4 and T5 were rejected once each (code 4001, nothing broadcast) before passing |
