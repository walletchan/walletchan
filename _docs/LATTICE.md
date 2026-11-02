# GridPlus Lattice1 integration (private fork)

Status (2026-11-02): phase 0 (protocol port) and phase 1 (account type)
committed on branch `lattice`. The protocol layer passed real-device QA on
2026-11-02 (below). The extension setup and signing flows have not run on the
device yet.

Templates:

- **WalletChan integration:** the Ledger account type. Each Ledger file gets a
  Lattice counterpart; see the file map in the assessment
  (`Live_Sim_Mix/docs/walletchan_lattice_assessment.md`).
- **Lattice protocol:** ape-grid-lattice, ported to TypeScript in
  `apps/extension/src/chrome/lattice/protocol/` (module README maps each file).

## Phase 0: protocol port

- Pure TypeScript. Crypto from `@noble/curves` 1.9.1 (exact pin, the same copy
  viem already uses), WebCrypto AES-CBC and viem. No gridplus-sdk dependency.
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

Bundle budget: WalletChan pins the background bundle at 4,194,304 bytes
(`privacy-prover.budgets.json`, `tests/privacy/protocolManifest.test.ts`). With
phase 1 the bundle is 4,194,124 bytes, 180 under. Getting there took: WebCrypto
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

| Gap | Plan |
| --- | --- |
| EIP-712 shows hashes on the device | Port the `ETH_MSG` EIP-712 encoding with new parity fixtures |
| Calldata shows raw on the device | Attach decoders from WalletChan's ABI resolution; add tuples to `calldata.ts` |
| Force inclusion | Add a Lattice factory to `RAW_FORCE_INCLUSION_SIGNERS` |
| Privacy Pools single transactions | Add `lattice` to the Privacy Pools account validators and flip the capability |
| Built-in staking direct path | Add a Lattice branch next to `swaps/ledgerDirect.ts` |
| Onboarding step | Add Lattice to the first-account onboarding flow |
| Hash display in the review UI | Re-add a `detail` field to `latticeStatus` (digest, or EIP-712 domain and message hashes) together with the review UI that renders it |
| Real-device QA | Smoke script passed 2026-11-02; still to run: the setup and signing flows in the built extension |
