/**
 * Codegen: emit src/constants/knownChains.generated.ts from
 * `@metamask/delegation-deployments` v1.3.0.
 *
 * Every chainId in the emitted KNOWN_CHAINS map has the canonical MM
 * EIP7702StatelessDeleGator deployed at EIP_7702_DEFAULT_DELEGATE
 * (0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B), CREATE2'd to the same
 * address across all chains. Custom (user-added) chains whose chainId
 * matches an entry here automatically qualify for atomic 7702 batching
 * via the WalletChan default delegate — no per-chain configuration needed.
 *
 * Run via `pnpm regen-chains` whenever MM publishes a new release of the
 * delegation-deployments package. Commit the generated file so consumers
 * don't need the dev dependency at runtime.
 *
 * Source-of-truth precedence:
 *   1. viem's chains export (name, native currency, default RPC, explorer)
 *   2. MANUAL_OVERRIDES below (for chains viem doesn't ship yet)
 *   3. skip + warn (chain in MM's list but we can't source metadata)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { DELEGATOR_CONTRACTS } from "@metamask/delegation-deployments";
import * as viemChains from "viem/chains";
import type { Chain } from "viem";
import {
  BASESCAN_URL,
  ETHERSCAN_URL,
  KNOWN_CHAIN_URLS,
  SEPOLIA_ETHERSCAN_URL,
} from "../src/constants/externalUrls";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * Chains already in WalletChan's CHAIN_REGISTRY. Excluded from KNOWN_CHAINS
 * because the full registry entry supersedes — KNOWN_CHAINS is only consulted
 * for chainIds not in CHAIN_REGISTRY (i.e. user-added custom chains).
 */
const BUILT_IN_CHAIN_IDS = new Set([
  1, // Ethereum
  42161, // Arbitrum
  8453, // Base
  56, // BNB Chain
  10, // Optimism
  4326, // MegaETH
  137, // Polygon
  4217, // Tempo
  130, // Unichain
]);

/**
 * Chains that exist in MM's v1.3.0 deployment but viem doesn't ship a Chain
 * export for. Manually fill in canonical metadata so KNOWN_CHAINS still
 * carries them. Keep RPCs to public endpoints — these are defaults the
 * user can override.
 */
interface ManualOverride {
  name: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpc: string;
  explorer: string;
  isTestnet: boolean;
}

// Preferred explorers override upstream metadata during regeneration.
const EXPLORER_OVERRIDES: Record<number, string> = {
  143: KNOWN_CHAIN_URLS[143].explorer, // Monad
};

/**
 * Per-chain RPC URLs we prefer over the viem default. Currently used to
 * route mainnet traffic through drpc.org — the same provider WalletChan
 * built-ins use (Ethereum, Base, Polygon) for better rate limits and
 * reliability than the chain's own public RPC. All endpoints verified via
 * `eth_chainId` round-trip in CI of this script. Chains that don't have a
 * drpc.org deployment (Citrea, Intuition) keep viem's default.
 */
const RPC_OVERRIDES: Record<number, string> = {
  // Mainnets — verified via eth_chainId round-trip
  100: KNOWN_CHAIN_URLS[100].rpc,
  143: KNOWN_CHAIN_URLS[143].rpc,
  146: KNOWN_CHAIN_URLS[146].rpc,
  1329: KNOWN_CHAIN_URLS[1329].rpc,
  2020: KNOWN_CHAIN_URLS[2020].rpc,
  5000: KNOWN_CHAIN_URLS[5000].rpc,
  42170: KNOWN_CHAIN_URLS[42170].rpc,
  42220: KNOWN_CHAIN_URLS[42220].rpc,
  57073: KNOWN_CHAIN_URLS[57073].rpc,
  59144: KNOWN_CHAIN_URLS[59144].rpc,
  80094: KNOWN_CHAIN_URLS[80094].rpc,
  747474: KNOWN_CHAIN_URLS[747474].rpc,
};

/**
 * Per-chain icon paths. All bundled locally under `public/chainIcons/` to
 * keep KNOWN_CHAINS independent of external CDNs at runtime — same trust
 * model as the built-in chain logos. Two file formats are in play:
 *
 *   • `.svg` — vector logos curated for first-class chains (Gnosis, Monad,
 *     Mantle, Celo, Ink, Linea, Berachain). Aliased in CHAIN_ICON_ALIASES.
 *   • `.webp` — raster logos fetched once from defillama's icon CDN and
 *     committed to the repo. Defillama serves webp despite the `.jpg` URL
 *     extension; we save them with the correct extension so browsers
 *     content-sniff correctly. ~130 KB total for 7 chains.
 *
 * Adding a new chain icon:
 *   1. Drop the asset in `apps/extension/public/chainIcons/<name>.<ext>`
 *   2. Add an entry here keyed by chainId
 *   3. Re-run `pnpm regen-chains`
 *
 * Chains without an entry (e.g. Intuition — no defillama coverage at time
 * of writing) fall through to the deterministic-initials placeholder.
 */
const ICON_OVERRIDES: Record<number, string> = {
  // Mainnet — curated SVGs
  100: "/chainIcons/gnosis.svg",
  143: "/chainIcons/monad.svg",
  5000: "/chainIcons/mantle.svg",
  42220: "/chainIcons/celo.svg",
  57073: "/chainIcons/ink.svg",
  59144: "/chainIcons/linea.svg",
  80094: "/chainIcons/berachain.svg",
  // Mainnet — bundled WebPs sourced from defillama
  146: "/chainIcons/sonic.webp",
  1329: "/chainIcons/sei.webp",
  2020: "/chainIcons/ronin.webp",
  4114: "/chainIcons/citrea.webp",
  42170: "/chainIcons/arbitrum-nova.webp",
  747474: "/chainIcons/katana.webp",
  // Intuition (1155) — no defillama coverage; placeholder fallback.
};

const MANUAL_OVERRIDES: Record<number, ManualOverride> = {
  // Tempo Moderato (testnet) — viem's tempoModerato has the right chainId but
  // doesn't set `testnet: true`, so we override here to force the flag and to
  // give a more recognisable display name.
  42431: {
    name: "Tempo Testnet (Moderato)",
    nativeCurrency: { name: "USD", symbol: "USD", decimals: 6 },
    rpc: KNOWN_CHAIN_URLS[42431].rpc,
    explorer: KNOWN_CHAIN_URLS[42431].explorer,
    isTestnet: true,
  },
  // Sonic Testnet — MM's delegator is deployed on chainId 14601 (0x3909),
  // which differs from viem's sonicTestnet at 64165. Use MM's chainId as the
  // source of truth since the delegator is what we care about.
  14601: {
    name: "Sonic Testnet",
    nativeCurrency: { name: "Sonic", symbol: "S", decimals: 18 },
    rpc: KNOWN_CHAIN_URLS[14601].rpc,
    explorer: KNOWN_CHAIN_URLS[14601].explorer,
    isTestnet: true,
  },
  // Ronin Saigon — MM's delegator is at 202601 (0x31769); viem's `saigon`
  // is 2021. Trust MM's deployment chainId.
  202601: {
    name: "Ronin Saigon",
    nativeCurrency: { name: "RON", symbol: "RON", decimals: 18 },
    rpc: KNOWN_CHAIN_URLS[202601].rpc,
    explorer: KNOWN_CHAIN_URLS[202601].explorer,
    isTestnet: true,
  },
  // Intuition (TRUST L1) — mainnet
  1155: {
    name: "Intuition",
    nativeCurrency: { name: "TRUST", symbol: "TRUST", decimals: 18 },
    rpc: KNOWN_CHAIN_URLS[1155].rpc,
    explorer: KNOWN_CHAIN_URLS[1155].explorer,
    isTestnet: false,
  },
  // Intuition testnet
  13579: {
    name: "Intuition Testnet",
    nativeCurrency: { name: "TRUST", symbol: "TRUST", decimals: 18 },
    rpc: KNOWN_CHAIN_URLS[13579].rpc,
    explorer: KNOWN_CHAIN_URLS[13579].explorer,
    isTestnet: true,
  },
  // Citrea (Bitcoin zkrollup) — mainnet
  4114: {
    name: "Citrea",
    nativeCurrency: { name: "cBTC", symbol: "cBTC", decimals: 18 },
    rpc: KNOWN_CHAIN_URLS[4114].rpc,
    explorer: KNOWN_CHAIN_URLS[4114].explorer,
    isTestnet: false,
  },
  // Hoodi testnet (Ethereum staking devnet)
  560048: {
    name: "Hoodi",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpc: KNOWN_CHAIN_URLS[560048].rpc,
    explorer: KNOWN_CHAIN_URLS[560048].explorer,
    isTestnet: true,
  },
  // Katana Bokuto (testnet)
  737373: {
    name: "Katana Bokuto",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpc: KNOWN_CHAIN_URLS[737373].rpc,
    explorer: KNOWN_CHAIN_URLS[737373].explorer,
    isTestnet: true,
  },
};

// ---------------------------------------------------------------------------
// Lookup: chainId → viem Chain
// ---------------------------------------------------------------------------

const viemChainById = new Map<number, Chain>();
for (const v of Object.values(viemChains) as Chain[]) {
  if (v && typeof v.id === "number" && !viemChainById.has(v.id)) {
    viemChainById.set(v.id, v);
  }
}

// ---------------------------------------------------------------------------
// Build entries from v1.3.0 deployment list
// ---------------------------------------------------------------------------

interface Entry {
  chainId: number;
  name: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  defaultRpc: string;
  explorer: string;
  isTestnet: boolean;
  /**
   * Local SVG path or external icon URL. Optional — chains without an entry
   * here render the deterministic-initials placeholder. See ICON_OVERRIDES.
   */
  icon?: string;
}

const v13 = DELEGATOR_CONTRACTS["1.3.0"];
if (!v13) {
  console.error(
    "[generate-known-chains] DELEGATOR_CONTRACTS['1.3.0'] missing — check @metamask/delegation-deployments version",
  );
  process.exit(1);
}

const entries: Entry[] = [];
const skipped: number[] = [];

for (const chainIdStr of Object.keys(v13)) {
  const chainId = Number(chainIdStr);
  if (BUILT_IN_CHAIN_IDS.has(chainId)) continue;

  // Manual overrides take precedence over viem — viem sometimes lacks the
  // `testnet: true` flag, ships outdated chainIds, or has wrong native
  // currency metadata. Our overrides are curated against MM's deployment
  // list (the actual source of truth for what delegator address is live).
  const override = MANUAL_OVERRIDES[chainId];
  if (override) {
    entries.push({
      chainId,
      name: override.name,
      nativeCurrency: override.nativeCurrency,
      defaultRpc: RPC_OVERRIDES[chainId] ?? override.rpc,
      explorer: EXPLORER_OVERRIDES[chainId] ?? override.explorer,
      isTestnet: override.isTestnet,
      icon: ICON_OVERRIDES[chainId],
    });
    continue;
  }

  const viem = viemChainById.get(chainId);
  if (viem) {
    entries.push({
      chainId,
      name: viem.name,
      nativeCurrency: viem.nativeCurrency,
      defaultRpc: RPC_OVERRIDES[chainId] ?? viem.rpcUrls.default.http[0] ?? "",
      explorer: EXPLORER_OVERRIDES[chainId] ?? viem.blockExplorers?.default?.url ?? "",
      isTestnet: Boolean(viem.testnet),
      icon: ICON_OVERRIDES[chainId],
    });
    continue;
  }

  skipped.push(chainId);
}

// Sort: mainnets first, then testnets; both by chainId asc.
entries.sort((a, b) => {
  if (a.isTestnet !== b.isTestnet) return a.isTestnet ? 1 : -1;
  return a.chainId - b.chainId;
});

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

function formatEntry(e: Entry, indent: string): string {
  const nc = e.nativeCurrency;
  const lines = [
    `${indent}${e.chainId}: {`,
    `${indent}  chainId: ${e.chainId},`,
    `${indent}  name: ${JSON.stringify(e.name)},`,
    `${indent}  nativeCurrency: { name: ${JSON.stringify(nc.name)}, symbol: ${JSON.stringify(nc.symbol)}, decimals: ${nc.decimals} },`,
    `${indent}  defaultRpc: KNOWN_CHAIN_URLS[${e.chainId}].rpc,`,
    `${indent}  explorer: KNOWN_CHAIN_URLS[${e.chainId}].explorer,`,
    `${indent}  isTestnet: ${e.isTestnet},`,
  ];
  if (e.icon) lines.push(`${indent}  icon: ${JSON.stringify(e.icon)},`);
  lines.push(`${indent}},`);
  return lines.join("\n");
}

const mainnetEntries = entries.filter((e) => !e.isTestnet);
const testnetEntries = entries.filter((e) => e.isTestnet);

const body = [
  "// AUTO-GENERATED — DO NOT EDIT. Run `pnpm regen-chains` to regenerate.",
  "//",
  "// Source: @metamask/delegation-deployments v1.3.0 deployment list.",
  "// Every chainId here has the MM EIP7702StatelessDeleGator deployed at",
  "// EIP_7702_DEFAULT_DELEGATE — so custom-chain users whose chainId matches",
  "// an entry below get atomic 7702 batching by default (no manual delegate",
  "// configuration required).",
  "",
  'import { KNOWN_CHAIN_URLS } from "./externalUrls";',
  "",
  "export interface KnownChainMetadata {",
  "  chainId: number;",
  "  name: string;",
  "  nativeCurrency: { name: string; symbol: string; decimals: number };",
  "  defaultRpc: string;",
  "  explorer: string;",
  "  isTestnet: boolean;",
  "  /**",
  "   * Local SVG path (\"/chainIcons/...\") or external icon URL. Consumed by",
  "   * `resolveChainIconMeta` after the built-in registry + named-alias",
  "   * lookups. Absent on chains we don't yet have an icon source for —",
  "   * those fall through to the deterministic-initials placeholder.",
  "   */",
  "  icon?: string;",
  "}",
  "",
  "export const KNOWN_CHAINS: Record<number, KnownChainMetadata> = {",
  "  // ---------- Mainnets ----------",
  ...mainnetEntries.map((e) => formatEntry(e, "  ")),
  "",
  "  // ---------- Testnets ----------",
  ...testnetEntries.map((e) => formatEntry(e, "  ")),
  "};",
  "",
  "export const KNOWN_CHAIN_IDS = new Set<number>(",
  "  Object.keys(KNOWN_CHAINS).map((k) => Number(k)),",
  ");",
  "",
].join("\n");

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const outPath = resolve(__dirname, "../src/constants/knownChains.generated.ts");
// Replace only the generated URL section; retain all manually reviewed services.
const urlsPath = resolve(__dirname, "../src/constants/externalUrls.ts");
const urlsSource = readFileSync(urlsPath, "utf8");
const startMarker = "// BEGIN GENERATED KNOWN CHAIN URLS (pnpm regen-chains)";
const endMarker = "// END GENERATED KNOWN CHAIN URLS";
const start = urlsSource.indexOf(startMarker);
const end = urlsSource.indexOf(endMarker);
if (start < 0 || end < start) throw new Error("Missing generated URL section markers");
const explorerReferences = new Map([
  [ETHERSCAN_URL, "ETHERSCAN_URL"],
  [SEPOLIA_ETHERSCAN_URL, "SEPOLIA_ETHERSCAN_URL"],
  [BASESCAN_URL, "BASESCAN_URL"],
]);
const urlSection = [
  startMarker,
  "export const KNOWN_CHAIN_URLS = {",
  ...entries.map((entry) =>
    `  ${entry.chainId}: { rpc: ${JSON.stringify(entry.defaultRpc)}, explorer: ${explorerReferences.get(entry.explorer) ?? JSON.stringify(entry.explorer)} },`,
  ),
  "} as const;",
  endMarker,
].join("\n");
writeFileSync(urlsPath, urlsSource.slice(0, start) + urlSection + urlsSource.slice(end + endMarker.length), "utf8");
writeFileSync(outPath, body, "utf8");

console.log(
  `[generate-known-chains] wrote ${entries.length} entries (${mainnetEntries.length} mainnet, ${testnetEntries.length} testnet) → ${outPath}`,
);
if (skipped.length > 0) {
  console.warn(
    `[generate-known-chains] skipped ${skipped.length} chainIds with no viem entry and no manual override: ${skipped.join(", ")}`,
  );
  console.warn(
    "  → add a MANUAL_OVERRIDES entry for each, then re-run.",
  );
}
