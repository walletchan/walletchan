/**
 * Single source of truth for all supported chains.
 *
 * Adding a new chain? Add its metadata to CHAIN_REGISTRY below and its
 * RPC/explorer endpoints to BUILT_IN_CHAIN_URLS in externalUrls.ts.
 * All derived maps, sets, and config objects auto-populate.
 *
 * Runtime note: UI/background code should usually go through `lib/chains.ts`
 * instead of reading `CHAIN_REGISTRY` and `networksInfo` separately. That
 * resolver is what keeps built-in chains, user RPC overrides, hidden flags,
 * and custom chains in sync everywhere.
 */

import { BUILT_IN_CHAIN_URLS } from "./externalUrls";

import { type Chain } from "viem";
import { ACCOUNT_TYPE_CAPABILITIES } from "../chrome/accounts/accountTypePolicy";
import type { AccountType } from "../chrome/types";
import {
  abstract,
  arbitrum,
  avalanche,
  berachain,
  blast,
  mainnet,
  hyperEvm,
  ink,
  linea,
  mantle,
  megaeth,
  mode,
  monad,
  polygon,
  plasma,
  scroll,
  sonic,
  tempo,
  base,
  bsc,
  worldchain,
  zkSync,
  // OP Stack chains for force inclusion support
  baseSepolia,
  optimism,
  optimismSepolia,
  unichain,
  unichainSepolia,
  zora,
  zoraSepolia,
  worldchainSepolia,
} from "viem/chains";
import { type NetworksInfo } from "@/types";

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export interface ChainLogoColorScheme {
  /** Surface painted behind transparent or low-contrast logo artwork. */
  surface: string;
  /** Outer edge color for the logo surface. */
  border: string;
  /** Inner edge color that keeps the surface distinct from its surroundings. */
  insetOutline: string;
}

export interface ChainLogoStyle {
  light: ChainLogoColorScheme;
  dark?: ChainLogoColorScheme;
}

export interface ChainEntry {
  chainId: number;
  /** True for first-class testnets that ship hidden until explicitly enabled. */
  isTestnet?: boolean;
  /** Mainnet whose icon, colors, and compatible runtime policy this testnet inherits. */
  parentChainId?: number;
  /** Testnet chain IDs that should reuse this chain's visual identity. */
  testnetChainIds: readonly number[];
  name: string;
  rpcUrl: string;
  explorer: string;
  /** Icon path relative to extension public dir */
  icon: string;
  /** Optional logo-specific legibility treatment, inherited by testnets. */
  logoStyle?: ChainLogoStyle;
  /** UI brand colors */
  bg: string;
  border: string;
  text: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  /**
   * Whether eth_getBalance represents a real user-owned native asset.
   * Defaults to true. Chains such as Tempo still require nativeCurrency
   * metadata for EVM compatibility and fee display, but have no native token.
   */
  hasNativeToken?: boolean;
  /** Hidden until the user explicitly enables the chain in Settings. */
  hiddenByDefault?: boolean;
  /** Whether this chain uses OP Stack (for L1 fee breakdown in gas display) */
  isOpStack: boolean;
  /**
   * Whether this chain supports Flashblocks (~200ms preconfirmations exposed via
   * standard eth_getTransactionReceipt on Flashblocks-aware RPC endpoints).
   * Triggers a fast-poll phase in the receipt poller. Harmless on RPCs that
   * don't support Flashblocks — they just respond with normal-block-time
   * receipts and the poller transitions to standard backoff.
   */
  supportsFlashblocks?: boolean;
  /**
   * Whether this chain supports EIP-7966 eth_sendRawTransactionSync — submit
   * a signed tx and the RPC returns the full receipt in one round trip
   * (MegaETH ~100ms). Local-signing only (PK/Seed); Bankr accounts ignore.
   * On failure or timeout the broadcaster falls back to standard send +
   * receipt polling.
   */
  supportsSyncSend?: boolean;
  /**
   * Multiplier applied to the eth_estimateGas result to allow headroom for
   * state changes between estimate and inclusion. Default 20 (= 1.2×).
   */
  gasBufferPct?: number;
  /**
   * Whether this chain uses a gas model that differs from standard EVM
   * (e.g., MegaETH's dual compute + storage gas accounting with SSTORE
   * bucket multipliers). When true:
   *
   *   1. Dapp-provided `tx.gas` values are stripped at intake — wagmi/ethers
   *      compute against standard EVM rules and produce wrong values.
   *   2. Batch gas estimation skips the GAS-opcode-based bytecode injection
   *      trick — it counts only compute gas, missing the storage dimension.
   *   3. We always defer to the chain's own `eth_estimateGas`, which knows
   *      its gas model and returns accurate values.
   *
   * Fee fields (maxFeePerGas etc.) are still honored — under-priced fees
   * only delay inclusion, they don't cause reverts.
   */
  usesNonStandardGasModel?: boolean;
  /** Whether the Bankr API supports this chain */
  isBankrSupported: boolean;
  /** Whether 0x Swap API supports this chain */
  isSwapSupported: boolean;
  /**
   * Whether this chain supports EIP-7702 (Pectra activation live). When true,
   * PK/SP accounts can authorize a smart-contract delegate (the MM
   * EIP7702StatelessDeleGator by default) and execute atomic batches as a
   * single tx. When false, PK/SP batches fall back to auto-sequential.
   * Custom chains can opt in by configuring a delegate in Account Settings,
   * regardless of this flag.
   */
  isEip7702Supported?: boolean;
  /** CoinGecko token ID for native token price lookups (undefined = no price) */
  coingeckoTokenId?: string;
  /** CoinGecko platform ID for token list lookups (e.g. "base", "ethereum") */
  coingeckoPlatformId?: string;
  /**
   * GeckoTerminal network slug (e.g. "eth", "base", "polygon_pos"). Used as
   * a fallback price source for tokens CoinGecko doesn't index. GeckoTerminal
   * derives prices from onchain DEX liquidity so it covers exotic / new
   * tokens that the CoinGecko `/simple/token_price` endpoint misses.
   * undefined = no GeckoTerminal coverage for this chain.
   */
  geckoTerminalNetworkId?: string;
  /** Pre-built viem Chain object (for chains in viem/chains). Omit for custom chains. */
  viemChain?: Chain;
}

/** Subset exposed by chainConfig.ts consumers */
export interface ChainConfig {
  name: string;
  bg: string;
  border: string;
  text: string;
  icon: string;
  logoStyle?: ChainLogoStyle;
  explorer: string;
}

// ---------------------------------------------------------------------------
// Registry — THE single list. Edit here to add/remove chains.
// ---------------------------------------------------------------------------

const ETH_CURRENCY = { name: "Ether", symbol: "ETH", decimals: 18 };

export const MAINNET_CHAIN_REGISTRY: readonly ChainEntry[] = [
  // Ethereum first, then alphabetical
  {
    chainId: 1,
    testnetChainIds: [11155111, 560048],
    name: "Ethereum",
    rpcUrl: BUILT_IN_CHAIN_URLS[1].rpc,
    explorer: BUILT_IN_CHAIN_URLS[1].explorer,
    icon: "/chainIcons/ethereum.svg",
    bg: "rgba(98, 126, 234, 0.15)",
    border: "rgba(98, 126, 234, 0.4)",
    text: "#627EEA",
    nativeCurrency: ETH_CURRENCY,
    isOpStack: false,
    isBankrSupported: true,
    isSwapSupported: true,
    isEip7702Supported: true,
    coingeckoTokenId: "ethereum",
    coingeckoPlatformId: "ethereum",
    geckoTerminalNetworkId: "eth",
    viemChain: mainnet,
  },
  {
    chainId: 2741,
    testnetChainIds: [11124],
    name: "Abstract",
    rpcUrl: BUILT_IN_CHAIN_URLS[2741].rpc,
    explorer: BUILT_IN_CHAIN_URLS[2741].explorer,
    icon: "/chainIcons/abstract.webp",
    bg: "rgba(128, 255, 0, 0.15)",
    border: "rgba(128, 255, 0, 0.4)",
    text: "#80FF00",
    nativeCurrency: ETH_CURRENCY,
    isOpStack: false,
    isBankrSupported: false,
    isSwapSupported: true,
    isEip7702Supported: false,
    coingeckoTokenId: "ethereum",
    coingeckoPlatformId: "abstract",
    geckoTerminalNetworkId: "abstract",
    viemChain: abstract,
  },
  {
    chainId: 42161,
    testnetChainIds: [421614],
    name: "Arbitrum",
    rpcUrl: BUILT_IN_CHAIN_URLS[42161].rpc,
    explorer: BUILT_IN_CHAIN_URLS[42161].explorer,
    icon: "/chainIcons/arbitrum.svg",
    bg: "rgba(40, 160, 240, 0.15)",
    border: "rgba(40, 160, 240, 0.4)",
    text: "#28A0F0",
    nativeCurrency: ETH_CURRENCY,
    isOpStack: false,
    isBankrSupported: true,
    isSwapSupported: true,
    isEip7702Supported: true,
    coingeckoTokenId: "ethereum",
    coingeckoPlatformId: "arbitrum-one",
    geckoTerminalNetworkId: "arbitrum",
    viemChain: arbitrum,
  },
  {
    chainId: 43114,
    testnetChainIds: [43113],
    name: "Avalanche",
    rpcUrl: BUILT_IN_CHAIN_URLS[43114].rpc,
    explorer: BUILT_IN_CHAIN_URLS[43114].explorer,
    icon: "/chainIcons/avalanche.svg",
    bg: "rgba(232, 65, 66, 0.15)",
    border: "rgba(232, 65, 66, 0.4)",
    text: "#E84142",
    nativeCurrency: { name: "Avalanche", symbol: "AVAX", decimals: 18 },
    isOpStack: false,
    isBankrSupported: false,
    isSwapSupported: true,
    isEip7702Supported: false,
    coingeckoTokenId: "avalanche-2",
    coingeckoPlatformId: "avalanche",
    geckoTerminalNetworkId: "avax",
    viemChain: avalanche,
  },
  {
    chainId: 8453,
    testnetChainIds: [84532],
    name: "Base",
    rpcUrl: BUILT_IN_CHAIN_URLS[8453].rpc,
    explorer: BUILT_IN_CHAIN_URLS[8453].explorer,
    icon: "/chainIcons/base.svg",
    bg: "rgba(0, 82, 255, 0.15)",
    border: "rgba(0, 82, 255, 0.4)",
    text: "#0052FF",
    nativeCurrency: ETH_CURRENCY,
    isOpStack: true,
    supportsFlashblocks: true,
    isBankrSupported: true,
    isSwapSupported: true,
    isEip7702Supported: true,
    coingeckoTokenId: "ethereum",
    coingeckoPlatformId: "base",
    geckoTerminalNetworkId: "base",
    viemChain: base,
  },
  {
    chainId: 80094,
    testnetChainIds: [80069],
    name: "Berachain",
    rpcUrl: BUILT_IN_CHAIN_URLS[80094].rpc,
    explorer: BUILT_IN_CHAIN_URLS[80094].explorer,
    icon: "/chainIcons/berachain.svg",
    bg: "rgba(255, 183, 59, 0.15)",
    border: "rgba(255, 183, 59, 0.4)",
    text: "#FFB73B",
    nativeCurrency: { name: "BERA Token", symbol: "BERA", decimals: 18 },
    isOpStack: false,
    isBankrSupported: false,
    isSwapSupported: false, // 0x deprecation notice: 2026-09-21
    isEip7702Supported: true,
    coingeckoTokenId: "berachain-bera",
    coingeckoPlatformId: "berachain",
    geckoTerminalNetworkId: "berachain",
    viemChain: berachain,
  },
  {
    chainId: 81457,
    testnetChainIds: [168587773],
    name: "Blast",
    rpcUrl: BUILT_IN_CHAIN_URLS[81457].rpc,
    explorer: BUILT_IN_CHAIN_URLS[81457].explorer,
    icon: "/chainIcons/blast.svg",
    bg: "rgba(252, 252, 3, 0.15)",
    border: "rgba(252, 252, 3, 0.4)",
    text: "#FCFC03",
    nativeCurrency: ETH_CURRENCY,
    hiddenByDefault: true,
    isOpStack: true,
    isBankrSupported: false,
    isSwapSupported: false,
    isEip7702Supported: false,
    coingeckoTokenId: "ethereum",
    coingeckoPlatformId: "blast",
    geckoTerminalNetworkId: "blast",
    viemChain: blast,
  },
  {
    chainId: 56,
    testnetChainIds: [97],
    name: "BNB Chain",
    rpcUrl: BUILT_IN_CHAIN_URLS[56].rpc,
    explorer: BUILT_IN_CHAIN_URLS[56].explorer,
    icon: "/chainIcons/bnb.svg",
    bg: "rgba(243, 186, 47, 0.15)",
    border: "rgba(243, 186, 47, 0.4)",
    text: "#F3BA2F",
    nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
    isOpStack: false,
    isBankrSupported: true,
    isSwapSupported: true,
    isEip7702Supported: true,
    coingeckoTokenId: "binancecoin",
    coingeckoPlatformId: "binance-smart-chain",
    geckoTerminalNetworkId: "bsc",
    viemChain: bsc,
  },
  {
    chainId: 999,
    testnetChainIds: [998],
    name: "HyperEVM",
    rpcUrl: BUILT_IN_CHAIN_URLS[999].rpc,
    explorer: BUILT_IN_CHAIN_URLS[999].explorer,
    icon: "/chainIcons/hyperevm.svg",
    logoStyle: {
      light: {
        surface: "rgba(255, 255, 255, 0.94)",
        border: "rgba(255, 255, 255, 0.28)",
        insetOutline: "rgba(0, 0, 0, 0.08)",
      },
      dark: {
        surface: "rgba(9, 9, 11, 0.94)",
        border: "rgba(151, 252, 228, 0.28)",
        insetOutline: "rgba(255, 255, 255, 0.06)",
      },
    },
    bg: "rgba(80, 227, 194, 0.15)",
    border: "rgba(80, 227, 194, 0.4)",
    text: "#50E3C2",
    nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
    isOpStack: false,
    isBankrSupported: false,
    isSwapSupported: true,
    isEip7702Supported: false,
    coingeckoTokenId: "hyperliquid",
    coingeckoPlatformId: "hyperevm",
    geckoTerminalNetworkId: "hyperevm",
    viemChain: hyperEvm,
  },
  {
    chainId: 57073,
    testnetChainIds: [763373],
    name: "Ink",
    rpcUrl: BUILT_IN_CHAIN_URLS[57073].rpc,
    explorer: BUILT_IN_CHAIN_URLS[57073].explorer,
    icon: "/chainIcons/ink.svg",
    bg: "rgba(113, 50, 245, 0.15)",
    border: "rgba(113, 50, 245, 0.4)",
    text: "#7132F5",
    nativeCurrency: ETH_CURRENCY,
    isOpStack: true,
    isBankrSupported: false,
    isSwapSupported: true,
    isEip7702Supported: true,
    coingeckoTokenId: "ethereum",
    coingeckoPlatformId: "ink",
    geckoTerminalNetworkId: "ink",
    viemChain: ink,
  },
  {
    chainId: 59144,
    testnetChainIds: [59141],
    name: "Linea",
    rpcUrl: BUILT_IN_CHAIN_URLS[59144].rpc,
    explorer: BUILT_IN_CHAIN_URLS[59144].explorer,
    icon: "/chainIcons/linea.svg",
    bg: "rgba(97, 223, 255, 0.15)",
    border: "rgba(97, 223, 255, 0.4)",
    text: "#61DFFF",
    nativeCurrency: ETH_CURRENCY,
    isOpStack: false,
    isBankrSupported: false,
    isSwapSupported: true,
    isEip7702Supported: true,
    coingeckoTokenId: "ethereum",
    coingeckoPlatformId: "linea",
    geckoTerminalNetworkId: "linea",
    viemChain: linea,
  },
  {
    chainId: 5000,
    testnetChainIds: [5003],
    name: "Mantle",
    rpcUrl: BUILT_IN_CHAIN_URLS[5000].rpc,
    explorer: BUILT_IN_CHAIN_URLS[5000].explorer,
    icon: "/chainIcons/mantle.svg",
    bg: "rgba(101, 217, 206, 0.15)",
    border: "rgba(101, 217, 206, 0.4)",
    text: "#65D9CE",
    nativeCurrency: { name: "MNT", symbol: "MNT", decimals: 18 },
    hiddenByDefault: true,
    isOpStack: true,
    isBankrSupported: false,
    isSwapSupported: false, // 0x deprecation notice: 2026-09-21
    isEip7702Supported: true,
    coingeckoTokenId: "mantle",
    coingeckoPlatformId: "mantle",
    geckoTerminalNetworkId: "mantle",
    viemChain: mantle,
  },
  {
    chainId: 10,
    testnetChainIds: [11155420],
    name: "Optimism",
    rpcUrl: BUILT_IN_CHAIN_URLS[10].rpc,
    explorer: BUILT_IN_CHAIN_URLS[10].explorer,
    icon: "/chainIcons/optimism.svg",
    bg: "rgba(255, 4, 32, 0.15)",
    border: "rgba(255, 4, 32, 0.4)",
    text: "#FF0420",
    nativeCurrency: ETH_CURRENCY,
    isOpStack: true,
    supportsFlashblocks: true,
    isBankrSupported: false,
    isSwapSupported: true,
    isEip7702Supported: true,
    coingeckoTokenId: "ethereum",
    coingeckoPlatformId: "optimistic-ethereum",
    geckoTerminalNetworkId: "optimism",
    viemChain: optimism,
  },
  {
    chainId: 4326,
    testnetChainIds: [6343],
    name: "MegaETH",
    rpcUrl: BUILT_IN_CHAIN_URLS[4326].rpc,
    explorer: BUILT_IN_CHAIN_URLS[4326].explorer,
    icon: "/chainIcons/megaeth.svg",
    bg: "rgba(25, 25, 26, 0.15)",
    border: "rgba(25, 25, 26, 0.4)",
    text: "#19191A",
    nativeCurrency: ETH_CURRENCY,
    isOpStack: true,
    supportsSyncSend: true,
    // MegaETH's dual gas model (compute + storage with SSTORE bucket
    // multipliers) differs from standard EVM. Locally-computed gas values
    // (dapp-provided, GAS-opcode-based simulation) are systematically wrong;
    // we must defer to the chain's own eth_estimateGas which is accurate.
    usesNonStandardGasModel: true,
    isBankrSupported: false,
    isSwapSupported: false,
    isEip7702Supported: true,
    coingeckoTokenId: "ethereum",
    coingeckoPlatformId: "megaeth",
    geckoTerminalNetworkId: "megaeth",
    viemChain: megaeth,
  },
  {
    chainId: 34443,
    testnetChainIds: [919],
    name: "Mode",
    rpcUrl: BUILT_IN_CHAIN_URLS[34443].rpc,
    explorer: BUILT_IN_CHAIN_URLS[34443].explorer,
    icon: "/chainIcons/mode.svg",
    bg: "rgba(223, 254, 0, 0.15)",
    border: "rgba(223, 254, 0, 0.4)",
    text: "#DFFE00",
    nativeCurrency: ETH_CURRENCY,
    hiddenByDefault: true,
    isOpStack: true,
    isBankrSupported: false,
    isSwapSupported: false,
    isEip7702Supported: false,
    coingeckoTokenId: "ethereum",
    coingeckoPlatformId: "mode",
    geckoTerminalNetworkId: "mode",
    viemChain: mode,
  },
  {
    chainId: 143,
    testnetChainIds: [10143, 41454], // 41454 is legacy; retain existing icon coverage
    name: "Monad",
    rpcUrl: BUILT_IN_CHAIN_URLS[143].rpc,
    explorer: BUILT_IN_CHAIN_URLS[143].explorer,
    icon: "/chainIcons/monad.svg",
    bg: "rgba(131, 110, 249, 0.15)",
    border: "rgba(131, 110, 249, 0.4)",
    text: "#836EF9",
    nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
    isOpStack: false,
    isBankrSupported: false,
    isSwapSupported: true,
    isEip7702Supported: true,
    coingeckoTokenId: "monad",
    coingeckoPlatformId: "monad",
    geckoTerminalNetworkId: "monad",
    viemChain: monad,
  },
  {
    chainId: 9745,
    testnetChainIds: [9746],
    name: "Plasma",
    rpcUrl: BUILT_IN_CHAIN_URLS[9745].rpc,
    explorer: BUILT_IN_CHAIN_URLS[9745].explorer,
    icon: "/chainIcons/plasma.svg",
    bg: "rgba(79, 255, 176, 0.15)",
    border: "rgba(79, 255, 176, 0.4)",
    text: "#4FFFB0",
    nativeCurrency: { name: "Plasma", symbol: "XPL", decimals: 18 },
    isOpStack: false,
    isBankrSupported: false,
    isSwapSupported: true,
    isEip7702Supported: false,
    coingeckoTokenId: "plasma",
    coingeckoPlatformId: "plasma",
    geckoTerminalNetworkId: "plasma",
    viemChain: plasma,
  },
  {
    chainId: 137,
    testnetChainIds: [80002],
    name: "Polygon",
    rpcUrl: BUILT_IN_CHAIN_URLS[137].rpc,
    explorer: BUILT_IN_CHAIN_URLS[137].explorer,
    icon: "/chainIcons/polygon.svg",
    bg: "rgba(130, 71, 229, 0.15)",
    border: "rgba(130, 71, 229, 0.4)",
    text: "#8247E5",
    nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
    isOpStack: false,
    isBankrSupported: true,
    isSwapSupported: true,
    isEip7702Supported: true,
    coingeckoTokenId: "polygon-ecosystem-token",
    coingeckoPlatformId: "polygon-pos",
    geckoTerminalNetworkId: "polygon_pos",
    viemChain: polygon,
  },
  {
    chainId: 4663,
    testnetChainIds: [46630],
    name: "Robinhood Chain",
    rpcUrl: BUILT_IN_CHAIN_URLS[4663].rpc,
    explorer: BUILT_IN_CHAIN_URLS[4663].explorer,
    icon: "/chainIcons/robinhood.webp",
    bg: "rgba(0, 200, 5, 0.15)",
    border: "rgba(0, 200, 5, 0.4)",
    text: "#00C805",
    nativeCurrency: ETH_CURRENCY,
    isOpStack: false,
    isBankrSupported: true,
    isSwapSupported: true,
    // MetaMask upstream added 4663/46630 in smart-accounts-kit PR #277.
    // The published delegation-deployments 1.4.0 package predates that merge,
    // so this built-in flag is pinned to the live 2026-07-21 verification:
    // v1.3.0 bytecode is present and supports the plain ERC-7821 batch mode.
    isEip7702Supported: true,
    coingeckoTokenId: "ethereum",
    coingeckoPlatformId: "robinhood",
    geckoTerminalNetworkId: "robinhood",
  },
  {
    chainId: 534352,
    testnetChainIds: [534351],
    name: "Scroll",
    rpcUrl: BUILT_IN_CHAIN_URLS[534352].rpc,
    explorer: BUILT_IN_CHAIN_URLS[534352].explorer,
    icon: "/chainIcons/scroll.svg",
    bg: "rgba(235, 194, 142, 0.15)",
    border: "rgba(235, 194, 142, 0.4)",
    text: "#EBC28E",
    nativeCurrency: ETH_CURRENCY,
    hiddenByDefault: true,
    isOpStack: false,
    isBankrSupported: false,
    isSwapSupported: false, // 0x deprecation notice: 2026-09-21
    isEip7702Supported: false,
    coingeckoTokenId: "ethereum",
    coingeckoPlatformId: "scroll",
    geckoTerminalNetworkId: "scroll",
    viemChain: scroll,
  },
  {
    chainId: 146,
    testnetChainIds: [14601, 57054], // Blaze (57054) is legacy but still recognizable
    name: "Sonic",
    rpcUrl: BUILT_IN_CHAIN_URLS[146].rpc,
    explorer: BUILT_IN_CHAIN_URLS[146].explorer,
    icon: "/chainIcons/sonic.webp",
    bg: "rgba(53, 96, 255, 0.15)",
    border: "rgba(53, 96, 255, 0.4)",
    text: "#3560FF",
    nativeCurrency: { name: "Sonic", symbol: "S", decimals: 18 },
    hiddenByDefault: true,
    isOpStack: false,
    isBankrSupported: false,
    isSwapSupported: false, // 0x deprecation notice: 2026-09-21
    isEip7702Supported: true,
    coingeckoTokenId: "sonic-3",
    coingeckoPlatformId: "sonic",
    geckoTerminalNetworkId: "sonic",
    viemChain: sonic,
  },
  {
    chainId: 4217,
    testnetChainIds: [42431],
    name: "Tempo",
    rpcUrl: BUILT_IN_CHAIN_URLS[4217].rpc,
    explorer: BUILT_IN_CHAIN_URLS[4217].explorer,
    icon: "/chainIcons/tempo.webp",
    bg: "rgba(255, 77, 141, 0.15)",
    border: "rgba(255, 77, 141, 0.4)",
    text: "#FF4D8D",
    nativeCurrency: { name: "USD", symbol: "USD", decimals: 6 },
    hasNativeToken: false,
    isOpStack: false,
    isBankrSupported: false,
    isSwapSupported: true,
    isEip7702Supported: true,
    viemChain: tempo,
  },
  {
    chainId: 130,
    testnetChainIds: [1301],
    name: "Unichain",
    rpcUrl: BUILT_IN_CHAIN_URLS[130].rpc,
    explorer: BUILT_IN_CHAIN_URLS[130].explorer,
    icon: "/chainIcons/unichain.svg",
    bg: "rgba(255, 0, 122, 0.15)",
    border: "rgba(255, 0, 122, 0.4)",
    text: "#FF007A",
    nativeCurrency: ETH_CURRENCY,
    isOpStack: true,
    supportsFlashblocks: true,
    isBankrSupported: true,
    isSwapSupported: true,
    isEip7702Supported: true,
    coingeckoTokenId: "ethereum",
    coingeckoPlatformId: "unichain",
    geckoTerminalNetworkId: "unichain",
    viemChain: unichain,
  },
  {
    chainId: 480,
    testnetChainIds: [4801],
    name: "World Chain",
    rpcUrl: BUILT_IN_CHAIN_URLS[480].rpc,
    explorer: BUILT_IN_CHAIN_URLS[480].explorer,
    icon: "/chainIcons/worldchain.svg",
    bg: "rgba(255, 255, 255, 0.15)",
    border: "rgba(255, 255, 255, 0.4)",
    text: "#FFFFFF",
    nativeCurrency: ETH_CURRENCY,
    isOpStack: true,
    isBankrSupported: false,
    isSwapSupported: true,
    isEip7702Supported: false,
    coingeckoTokenId: "ethereum",
    coingeckoPlatformId: "world-chain",
    geckoTerminalNetworkId: "world-chain",
    viemChain: worldchain,
  },
  {
    chainId: 324,
    testnetChainIds: [300],
    name: "ZKsync Era",
    rpcUrl: BUILT_IN_CHAIN_URLS[324].rpc,
    explorer: BUILT_IN_CHAIN_URLS[324].explorer,
    icon: "/chainIcons/zksync.svg",
    bg: "rgba(78, 82, 154, 0.15)",
    border: "rgba(78, 82, 154, 0.4)",
    text: "#4E529A",
    nativeCurrency: ETH_CURRENCY,
    isOpStack: false,
    isBankrSupported: false,
    isSwapSupported: false,
    isEip7702Supported: false,
    coingeckoTokenId: "ethereum",
    coingeckoPlatformId: "zksync",
    geckoTerminalNetworkId: "zksync",
    viemChain: zkSync,
  },
] as const;

interface NativeTestnetSpec {
  chainId: number;
  parentChainId: number;
  name: string;
  rpcUrl: string;
  explorer: string;
  nativeCurrency: ChainEntry["nativeCurrency"];
  /** Opt in only after the exact default delegate passes live verification. */
  isEip7702Supported?: boolean;
}

/**
 * Current public testnets for WalletChan's built-in mainnets.
 *
 * RPCs are keyless endpoints verified with live `eth_chainId` calls. dRPC is
 * preferred when its public endpoint is available; operator/public endpoints
 * cover the remaining networks. Legacy IDs remain in the mainnet
 * `testnetChainIds` arrays for icon recognition but are not native entries.
 */
const NATIVE_TESTNET_SPECS: readonly NativeTestnetSpec[] = [
  { chainId: 11155111, parentChainId: 1, name: "Ethereum Sepolia", rpcUrl: BUILT_IN_CHAIN_URLS[11155111].rpc, explorer: BUILT_IN_CHAIN_URLS[11155111].explorer, nativeCurrency: ETH_CURRENCY, isEip7702Supported: true },
  { chainId: 560048, parentChainId: 1, name: "Ethereum Hoodi", rpcUrl: BUILT_IN_CHAIN_URLS[560048].rpc, explorer: BUILT_IN_CHAIN_URLS[560048].explorer, nativeCurrency: ETH_CURRENCY, isEip7702Supported: true },
  { chainId: 11124, parentChainId: 2741, name: "Abstract Sepolia", rpcUrl: BUILT_IN_CHAIN_URLS[11124].rpc, explorer: BUILT_IN_CHAIN_URLS[11124].explorer, nativeCurrency: ETH_CURRENCY },
  { chainId: 421614, parentChainId: 42161, name: "Arbitrum Sepolia", rpcUrl: BUILT_IN_CHAIN_URLS[421614].rpc, explorer: BUILT_IN_CHAIN_URLS[421614].explorer, nativeCurrency: ETH_CURRENCY, isEip7702Supported: true },
  { chainId: 43113, parentChainId: 43114, name: "Avalanche Fuji", rpcUrl: BUILT_IN_CHAIN_URLS[43113].rpc, explorer: BUILT_IN_CHAIN_URLS[43113].explorer, nativeCurrency: { name: "Avalanche", symbol: "AVAX", decimals: 18 } },
  { chainId: 84532, parentChainId: 8453, name: "Base Sepolia", rpcUrl: BUILT_IN_CHAIN_URLS[84532].rpc, explorer: BUILT_IN_CHAIN_URLS[84532].explorer, nativeCurrency: ETH_CURRENCY, isEip7702Supported: true },
  { chainId: 80069, parentChainId: 80094, name: "Berachain Bepolia", rpcUrl: BUILT_IN_CHAIN_URLS[80069].rpc, explorer: BUILT_IN_CHAIN_URLS[80069].explorer, nativeCurrency: { name: "Testnet BERA Token", symbol: "BERA", decimals: 18 }, isEip7702Supported: true },
  { chainId: 168587773, parentChainId: 81457, name: "Blast Sepolia", rpcUrl: BUILT_IN_CHAIN_URLS[168587773].rpc, explorer: BUILT_IN_CHAIN_URLS[168587773].explorer, nativeCurrency: ETH_CURRENCY },
  { chainId: 97, parentChainId: 56, name: "BNB Chain Testnet", rpcUrl: BUILT_IN_CHAIN_URLS[97].rpc, explorer: BUILT_IN_CHAIN_URLS[97].explorer, nativeCurrency: { name: "Test BNB", symbol: "tBNB", decimals: 18 }, isEip7702Supported: true },
  { chainId: 998, parentChainId: 999, name: "HyperEVM Testnet", rpcUrl: BUILT_IN_CHAIN_URLS[998].rpc, explorer: BUILT_IN_CHAIN_URLS[998].explorer, nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 } },
  { chainId: 763373, parentChainId: 57073, name: "Ink Sepolia", rpcUrl: BUILT_IN_CHAIN_URLS[763373].rpc, explorer: BUILT_IN_CHAIN_URLS[763373].explorer, nativeCurrency: ETH_CURRENCY, isEip7702Supported: true },
  { chainId: 59141, parentChainId: 59144, name: "Linea Sepolia", rpcUrl: BUILT_IN_CHAIN_URLS[59141].rpc, explorer: BUILT_IN_CHAIN_URLS[59141].explorer, nativeCurrency: ETH_CURRENCY, isEip7702Supported: true },
  { chainId: 5003, parentChainId: 5000, name: "Mantle Sepolia", rpcUrl: BUILT_IN_CHAIN_URLS[5003].rpc, explorer: BUILT_IN_CHAIN_URLS[5003].explorer, nativeCurrency: { name: "Sepolia Mantle", symbol: "MNT", decimals: 18 }, isEip7702Supported: true },
  { chainId: 11155420, parentChainId: 10, name: "Optimism Sepolia", rpcUrl: BUILT_IN_CHAIN_URLS[11155420].rpc, explorer: BUILT_IN_CHAIN_URLS[11155420].explorer, nativeCurrency: ETH_CURRENCY, isEip7702Supported: true },
  { chainId: 6343, parentChainId: 4326, name: "MegaETH Testnet", rpcUrl: BUILT_IN_CHAIN_URLS[6343].rpc, explorer: BUILT_IN_CHAIN_URLS[6343].explorer, nativeCurrency: ETH_CURRENCY, isEip7702Supported: true },
  { chainId: 919, parentChainId: 34443, name: "Mode Testnet", rpcUrl: BUILT_IN_CHAIN_URLS[919].rpc, explorer: BUILT_IN_CHAIN_URLS[919].explorer, nativeCurrency: ETH_CURRENCY },
  { chainId: 10143, parentChainId: 143, name: "Monad Testnet", rpcUrl: BUILT_IN_CHAIN_URLS[10143].rpc, explorer: BUILT_IN_CHAIN_URLS[10143].explorer, nativeCurrency: { name: "Testnet MON", symbol: "MON", decimals: 18 }, isEip7702Supported: true },
  { chainId: 9746, parentChainId: 9745, name: "Plasma Testnet", rpcUrl: BUILT_IN_CHAIN_URLS[9746].rpc, explorer: BUILT_IN_CHAIN_URLS[9746].explorer, nativeCurrency: { name: "Testnet Plasma", symbol: "XPL", decimals: 18 } },
  { chainId: 80002, parentChainId: 137, name: "Polygon Amoy", rpcUrl: BUILT_IN_CHAIN_URLS[80002].rpc, explorer: BUILT_IN_CHAIN_URLS[80002].explorer, nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 }, isEip7702Supported: true },
  { chainId: 46630, parentChainId: 4663, name: "Robinhood Chain Testnet", rpcUrl: BUILT_IN_CHAIN_URLS[46630].rpc, explorer: BUILT_IN_CHAIN_URLS[46630].explorer, nativeCurrency: ETH_CURRENCY, isEip7702Supported: true },
  { chainId: 534351, parentChainId: 534352, name: "Scroll Sepolia", rpcUrl: BUILT_IN_CHAIN_URLS[534351].rpc, explorer: BUILT_IN_CHAIN_URLS[534351].explorer, nativeCurrency: ETH_CURRENCY },
  { chainId: 14601, parentChainId: 146, name: "Sonic Testnet", rpcUrl: BUILT_IN_CHAIN_URLS[14601].rpc, explorer: BUILT_IN_CHAIN_URLS[14601].explorer, nativeCurrency: { name: "Sonic", symbol: "S", decimals: 18 }, isEip7702Supported: true },
  { chainId: 42431, parentChainId: 4217, name: "Tempo Moderato", rpcUrl: BUILT_IN_CHAIN_URLS[42431].rpc, explorer: BUILT_IN_CHAIN_URLS[42431].explorer, nativeCurrency: { name: "USD", symbol: "USD", decimals: 6 }, isEip7702Supported: true },
  { chainId: 1301, parentChainId: 130, name: "Unichain Sepolia", rpcUrl: BUILT_IN_CHAIN_URLS[1301].rpc, explorer: BUILT_IN_CHAIN_URLS[1301].explorer, nativeCurrency: ETH_CURRENCY, isEip7702Supported: true },
  { chainId: 4801, parentChainId: 480, name: "World Chain Sepolia", rpcUrl: BUILT_IN_CHAIN_URLS[4801].rpc, explorer: BUILT_IN_CHAIN_URLS[4801].explorer, nativeCurrency: ETH_CURRENCY },
  { chainId: 300, parentChainId: 324, name: "ZKsync Sepolia", rpcUrl: BUILT_IN_CHAIN_URLS[300].rpc, explorer: BUILT_IN_CHAIN_URLS[300].explorer, nativeCurrency: ETH_CURRENCY },
] as const;

export const TESTNET_CHAIN_REGISTRY: readonly ChainEntry[] = NATIVE_TESTNET_SPECS.map(
  (testnet) => {
    const parent = MAINNET_CHAIN_REGISTRY.find(
      (chain) => chain.chainId === testnet.parentChainId,
    );
    if (!parent) throw new Error(`Missing parent chain ${testnet.parentChainId}`);

    return {
      ...parent,
      ...testnet,
      testnetChainIds: [],
      isTestnet: true,
      hiddenByDefault: true,
      isBankrSupported: false,
      isSwapSupported: false,
      isEip7702Supported: testnet.isEip7702Supported ?? false,
      supportsFlashblocks: undefined,
      supportsSyncSend: undefined,
      coingeckoPlatformId: undefined,
      geckoTerminalNetworkId: undefined,
      viemChain: undefined,
    };
  },
);

/** Every chain that is natively available in Settings and local signing. */
export const CHAIN_REGISTRY: readonly ChainEntry[] = [
  ...MAINNET_CHAIN_REGISTRY,
  ...TESTNET_CHAIN_REGISTRY,
];

// ---------------------------------------------------------------------------
// Derived: chainConfig.ts exports
// ---------------------------------------------------------------------------

export const CHAIN_CONFIG: Record<number, ChainConfig> = {};
for (const c of CHAIN_REGISTRY) {
  CHAIN_CONFIG[c.chainId] = {
    name: c.name,
    bg: c.bg,
    border: c.border,
    text: c.text,
    icon: c.icon,
    logoStyle: c.logoStyle,
    explorer: c.explorer,
  };
}

export const DEFAULT_CHAIN_CONFIG: ChainConfig = {
  name: "Unknown",
  bg: "rgba(255, 255, 255, 0.1)",
  border: "rgba(255, 255, 255, 0.2)",
  text: "#FAFAFA",
  icon: "",
  explorer: "",
};

export function getChainConfig(chainId: number): ChainConfig {
  return CHAIN_CONFIG[chainId] || DEFAULT_CHAIN_CONFIG;
}

// ---------------------------------------------------------------------------
// Derived: networks.ts exports
// ---------------------------------------------------------------------------

export const DEFAULT_NETWORKS: NetworksInfo = {};
for (const c of CHAIN_REGISTRY) {
  DEFAULT_NETWORKS[c.name] = {
    chainId: c.chainId,
    rpcUrl: c.rpcUrl,
    hidden: c.hiddenByDefault ? true : undefined,
  };
}

export const ALLOWED_CHAIN_IDS = new Set(CHAIN_REGISTRY.map((c) => c.chainId));

export const BANKR_SUPPORTED_CHAIN_IDS = new Set(
  CHAIN_REGISTRY.filter((c) => c.isBankrSupported).map((c) => c.chainId)
);

// https://docs.0x.org/docs/introduction/supported-chains
export const ZEROX_SUPPORTED_CHAIN_IDS = new Set(
  CHAIN_REGISTRY.filter((c) => c.isSwapSupported).map((c) => c.chainId)
);

export const SWAP_SUPPORTED_CHAIN_IDS = ZEROX_SUPPORTED_CHAIN_IDS;

export const COINGECKO_PLATFORM_IDS: Record<number, string> = {};
for (const c of CHAIN_REGISTRY) {
  if (c.coingeckoPlatformId) {
    COINGECKO_PLATFORM_IDS[c.chainId] = c.coingeckoPlatformId;
  }
}

export const GECKOTERMINAL_NETWORK_IDS: Record<number, string> = {};
for (const c of CHAIN_REGISTRY) {
  if (c.geckoTerminalNetworkId) {
    GECKOTERMINAL_NETWORK_IDS[c.chainId] = c.geckoTerminalNetworkId;
  }
}

export const OP_STACK_CHAIN_IDS = new Set(
  CHAIN_REGISTRY.filter((c) => c.isOpStack).map((c) => c.chainId)
);

export const FLASHBLOCKS_CHAIN_IDS = new Set(
  CHAIN_REGISTRY.filter((c) => c.supportsFlashblocks).map((c) => c.chainId)
);

/**
 * Chains where EIP-7702 (Pectra) is active, so PK/SP accounts can authorize
 * a smart-contract delegate and execute atomic batches as a single tx. PK/SP
 * batches on these chains use the 7702 path; on other chains they fall back
 * to auto-sequential.
 *
 * Custom (user-added) chains whose chainId exists in KNOWN_CHAINS also use
 * the default delegate path. Other custom chains can opt into atomic batching
 * by setting a delegate explicitly in Account Settings — see
 * delegationResolution.ts.
 */
export const EIP7702_SUPPORTED_CHAIN_IDS = new Set(
  CHAIN_REGISTRY.filter((c) => c.isEip7702Supported).map((c) => c.chainId)
);

/**
 * MetaMask EIP7702StatelessDeleGator v1.3 — the default delegate WalletChan
 * authorizes for PK/SP accounts. CREATE2-deployed at the same address on
 * every chain via the canonical factory; verified on every WalletChan
 * built-in chain. Non-upgradeable, no admin, no owner. Audited by Cyfrin
 * (Apr 2025). Source: https://github.com/MetaMask/delegation-framework.
 *
 * Implements ERC-7821 `execute(bytes32 mode, bytes executionData)`, which is
 * exactly the format `encodeBatchCalls()` already produces for Bankr atomic
 * batches — same encoding works for 7702-delegated EOAs.
 *
 * Users can override this per-account×per-chain via the Smart Account section
 * in Account Settings (any ERC-7821-compatible contract).
 */
export const EIP_7702_DEFAULT_DELEGATE =
  "0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B" as `0x${string}`;

/**
 * EIP-7702 set-code prefix. The 23-byte sequence written into an EOA's `code`
 * field when it delegates: `0xef0100 || <20-byte delegate address>`. Used to
 * detect whether an EOA currently has an active delegation, and to extract
 * the delegate address from `eth_getCode`.
 */
export const EIP_7702_CODE_PREFIX = "0xef0100" as const;

/**
 * Friendly name for the default delegate we authorize. Used as a pill next
 * to the raw address on the confirm screen so users see a recognizable label
 * rather than a hex blob. Custom delegates the user pastes in Account
 * Settings intentionally have no entry — they fall back to the bare address.
 */
const KNOWN_DELEGATE_NAMES: Record<string, string> = {
  [EIP_7702_DEFAULT_DELEGATE.toLowerCase()]: "MetaMask DeleGator",
};

export function getKnownDelegateName(address: string): string | null {
  return KNOWN_DELEGATE_NAMES[address.toLowerCase()] ?? null;
}

/**
 * Chains whose gas model differs enough from standard EVM that batched
 * gas estimation is unreliable (MegaETH's compute+storage dual gas, etc.).
 * The wallet hides ERC-5792 batch capability for these so dapps fall back
 * to individual eth_sendTransaction, where the chain's own RPC produces
 * accurate per-tx estimates.
 */
export const NON_STANDARD_GAS_CHAIN_IDS = new Set(
  CHAIN_REGISTRY.filter((c) => c.usesNonStandardGasModel).map((c) => c.chainId)
);

export const CHAIN_NAMES: Record<number, string> = {};
for (const c of CHAIN_REGISTRY) {
  CHAIN_NAMES[c.chainId] = c.name;
}

// ---------------------------------------------------------------------------
// Derived: localSigner.ts exports (viem Chain objects + RPC URLs)
// ---------------------------------------------------------------------------

function buildViemChain(entry: ChainEntry): Chain {
  return {
    id: entry.chainId,
    name: entry.name,
    nativeCurrency: entry.nativeCurrency,
    rpcUrls: {
      default: { http: [entry.rpcUrl] },
    },
    blockExplorers: {
      default: { name: entry.name + " Explorer", url: entry.explorer },
    },
  };
}

const DEFAULT_NATIVE_CURRENCY = { name: "Ether", symbol: "ETH", decimals: 18 };

/** Build a viem Chain object at runtime for custom (user-added) chains. */
export function buildCustomViemChain(
  chainId: number,
  name: string,
  rpcUrl: string,
  nativeCurrency?: { name: string; symbol: string; decimals: number },
  explorer?: string,
): Chain {
  return {
    id: chainId,
    name,
    nativeCurrency: nativeCurrency ?? DEFAULT_NATIVE_CURRENCY,
    rpcUrls: {
      default: { http: [rpcUrl] },
    },
    blockExplorers: explorer
      ? { default: { name: name + " Explorer", url: explorer } }
      : undefined,
  };
}

export const VIEM_CHAINS: Record<number, Chain> = {};
for (const c of CHAIN_REGISTRY) {
  VIEM_CHAINS[c.chainId] = c.viemChain ?? buildViemChain(c);
}

export const RPC_URLS: Record<number, string> = {};
for (const c of CHAIN_REGISTRY) {
  RPC_URLS[c.chainId] = c.rpcUrl;
}

// ---------------------------------------------------------------------------
// Derived: gasEstimation.ts exports
// ---------------------------------------------------------------------------

export const CHAIN_TOKEN_IDS: Record<number, string> = {};
for (const c of CHAIN_REGISTRY) {
  if (c.coingeckoTokenId) {
    CHAIN_TOKEN_IDS[c.chainId] = c.coingeckoTokenId;
  }
}

// ---------------------------------------------------------------------------
// Derived: native currency symbols (for gas display)
// ---------------------------------------------------------------------------

/** Native currency symbols for hardcoded chains. Custom chains resolved at runtime from networksInfo. */
export const NATIVE_CURRENCY_SYMBOLS: Record<number, string> = {};
for (const c of CHAIN_REGISTRY) {
  NATIVE_CURRENCY_SYMBOLS[c.chainId] = c.nativeCurrency.symbol;
}

const CHAIN_IDENTITY_BY_ID = new Map<number, ChainEntry>();
for (const chain of CHAIN_REGISTRY) {
  CHAIN_IDENTITY_BY_ID.set(chain.chainId, chain);
  for (const testnetChainId of chain.testnetChainIds) {
    CHAIN_IDENTITY_BY_ID.set(testnetChainId, chain);
  }
}

/** Unknown/custom EVM chains retain the conventional native-token default. */
export function chainHasNativeToken(chainId: number): boolean {
  return CHAIN_IDENTITY_BY_ID.get(chainId)?.hasNativeToken !== false;
}

/**
 * Resolve native currency symbol for any chainId.
 * Checks CHAIN_REGISTRY first, then falls back to networksInfo in chrome.storage.
 * Returns "ETH" if chain is unknown (safe default).
 */
export async function getNativeCurrencySymbol(chainId: number): Promise<string> {
  // Fast path: hardcoded chain
  if (NATIVE_CURRENCY_SYMBOLS[chainId]) return NATIVE_CURRENCY_SYMBOLS[chainId];

  // Slow path: check custom chains in storage
  try {
    const { networksInfo } = await chrome.storage.sync.get("networksInfo");
    if (networksInfo) {
      for (const name of Object.keys(networksInfo)) {
        if (networksInfo[name].chainId === chainId) {
          return networksInfo[name].nativeCurrency?.symbol || "ETH";
        }
      }
    }
  } catch {
    // Storage may not be available in all contexts
  }

  return "ETH";
}

/**
 * Resolve explorer URL for any chainId.
 * Checks CHAIN_CONFIG first, then falls back to networksInfo in chrome.storage.
 * Returns "" if no explorer configured.
 */
export async function getExplorerUrl(chainId: number): Promise<string> {
  // Fast path: hardcoded chain
  if (CHAIN_CONFIG[chainId]?.explorer) return CHAIN_CONFIG[chainId].explorer;

  // Slow path: check custom chains in storage
  try {
    const { networksInfo } = await chrome.storage.sync.get("networksInfo");
    if (networksInfo) {
      for (const name of Object.keys(networksInfo)) {
        if (networksInfo[name].chainId === chainId) {
          return networksInfo[name].explorer || "";
        }
      }
    }
  } catch {
    // Storage may be unavailable in some execution contexts.
  }

  return "";
}

/**
 * Synchronous explorer URL resolver — checks CHAIN_CONFIG then networksInfo entry.
 * Use in React components where you already have networksInfo from context.
 */
export function getExplorerUrlSync(chainId: number, networksInfo?: Record<string, { chainId: number; explorer?: string }>): string {
  if (CHAIN_CONFIG[chainId]?.explorer) return CHAIN_CONFIG[chainId].explorer;
  if (networksInfo) {
    for (const name of Object.keys(networksInfo)) {
      if (networksInfo[name].chainId === chainId) {
        return networksInfo[name].explorer || "";
      }
    }
  }
  return "";
}

// ---------------------------------------------------------------------------
// Derived: Force Inclusion (OP Stack deposits and Arbitrum delayed inbox) support
// ---------------------------------------------------------------------------

export interface ForceInclusionChainInfo {
  viemChain: Chain;
  l1ChainId: number;
  l1ChainName: string;
  protocol: "op-stack" | "arbitrum";
  arbitrumContracts?: {
    inbox: `0x${string}`;
    bridge: `0x${string}`;
    sequencerInbox: `0x${string}`;
  };
}

/**
 * Verified chains that support force inclusion via their parent chain.
 * OP Stack entries require sourceId + portal in their viem definition.
 * Arbitrum entries explicitly pin parent-chain Inbox/Bridge/SequencerInbox.
 * Custom chains added by the user are also supported if their chainId matches.
 */
export const FORCE_INCLUSION_CHAINS: Map<number, ForceInclusionChainInfo> = new Map();

const OP_STACK_VIEM_CHAINS = [
  base, baseSepolia,
  optimism, optimismSepolia,
  unichain, unichainSepolia,
  blast,
  zora, zoraSepolia,
  worldchain, worldchainSepolia,
];

function getL1ChainName(sourceId: number): string {
  if (sourceId === 1) return "Ethereum";
  if (sourceId === 11155111) return "Sepolia";
  return `Chain ${sourceId}`;
}

function hasPortalContract(contracts: Chain["contracts"]): boolean {
  return !!contracts && "portal" in contracts && contracts.portal !== undefined;
}

for (const chain of OP_STACK_VIEM_CHAINS) {
  if (chain.sourceId && hasPortalContract(chain.contracts)) {
    FORCE_INCLUSION_CHAINS.set(chain.id, {
      viemChain: chain,
      l1ChainId: chain.sourceId,
      l1ChainName: getL1ChainName(chain.sourceId),
      protocol: "op-stack",
    });
  }
}

FORCE_INCLUSION_CHAINS.set(arbitrum.id, {
  viemChain: arbitrum,
  l1ChainId: mainnet.id,
  l1ChainName: "Ethereum",
  protocol: "arbitrum",
  arbitrumContracts: {
    inbox: "0x4Dbd4fc535Ac27206064B68FfCf827b0A60BAB3f",
    bridge: "0x8315177aB297bA92A06054cE80a67Ed4DBd7ed3a",
    sequencerInbox: "0x1c479675ad559DC151F6Ec7ed3FbF8ceE79582B6",
  },
});

// Robinhood's official node configs pin distinct Ethereum/Sepolia deployments.
// Verified onchain 2026-09-08; see _docs/ARBITRUM_FORCE_INCLUSION.md.
FORCE_INCLUSION_CHAINS.set(4663, {
  viemChain: VIEM_CHAINS[4663],
  l1ChainId: mainnet.id,
  l1ChainName: "Ethereum",
  protocol: "arbitrum",
  arbitrumContracts: {
    inbox: "0x1A07cc4BD17E0118BdB54D70990D2158AbAD7a2D",
    bridge: "0xDf8755334ce7A73cCF6b581C02eA649AE3E864b3",
    sequencerInbox: "0xBd0D173EEb87D57A09521c24388a12789F33ba96",
  },
});
FORCE_INCLUSION_CHAINS.set(46630, {
  viemChain: VIEM_CHAINS[46630],
  l1ChainId: 11155111,
  l1ChainName: "Sepolia",
  protocol: "arbitrum",
  arbitrumContracts: {
    inbox: "0xF2939afA86F6f933A3CE17fCAB007907B6b0B7a4",
    bridge: "0x96295BDad104eaD97cC08797b3dC68efF59CcF30",
    sequencerInbox: "0xA0D9dB3DC9791D54b5183C1C1866eFe1eCA7D414",
  },
});

export function isForceInclusionSupported(chainId: number): boolean {
  return FORCE_INCLUSION_CHAINS.has(chainId);
}

/**
 * Force inclusion is gated per account type because Bankr accounts submit the
 * L1 deposit through the Bankr API, which only supports chains in
 * BANKR_SUPPORTED_CHAIN_IDS. Currently that's mainnet (Ethereum, etc.) only —
 * Sepolia is not supported. PK/Seed accounts broadcast L1 directly and work on
 * any L1 with an RPC endpoint.
 */
export function isForceInclusionSupportedForAccount(
  l2ChainId: number,
  accountType: AccountType | undefined,
  mode: "single" | "batch" = "single",
): boolean {
  if (!accountType || !Object.prototype.hasOwnProperty.call(ACCOUNT_TYPE_CAPABILITIES, accountType)) return false;
  const capability = ACCOUNT_TYPE_CAPABILITIES[accountType];
  if (!capability.directSigner || !capability.forceInclusion) return false;
  const info = FORCE_INCLUSION_CHAINS.get(l2ChainId);
  if (!info) return false;
  if (mode === "batch" && (!capability.forceInclusionBatch || info.protocol !== "op-stack")) return false;
  if (capability.forceInclusion === "raw") return true;
  return info.protocol === "op-stack" && BANKR_SUPPORTED_CHAIN_IDS.has(info.l1ChainId);
}
