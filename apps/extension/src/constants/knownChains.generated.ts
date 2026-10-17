// AUTO-GENERATED — DO NOT EDIT. Run `pnpm regen-chains` to regenerate.
//
// Source: @metamask/delegation-deployments v1.3.0 deployment list.
// Every chainId here has the MM EIP7702StatelessDeleGator deployed at
// EIP_7702_DEFAULT_DELEGATE — so custom-chain users whose chainId matches
// an entry below get atomic 7702 batching by default (no manual delegate
// configuration required).

import { KNOWN_CHAIN_URLS } from "./externalUrls";

export interface KnownChainMetadata {
  chainId: number;
  name: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  defaultRpc: string;
  explorer: string;
  isTestnet: boolean;
  /**
   * Local SVG path ("/chainIcons/...") or external icon URL. Consumed by
   * `resolveChainIconMeta` after the built-in registry + named-alias
   * lookups. Absent on chains we don't yet have an icon source for —
   * those fall through to the deterministic-initials placeholder.
   */
  icon?: string;
}

export const KNOWN_CHAINS: Record<number, KnownChainMetadata> = {
  // ---------- Mainnets ----------
  100: {
    chainId: 100,
    name: "Gnosis",
    nativeCurrency: { name: "xDAI", symbol: "XDAI", decimals: 18 },
    defaultRpc: KNOWN_CHAIN_URLS[100].rpc,
    explorer: KNOWN_CHAIN_URLS[100].explorer,
    isTestnet: false,
    icon: "/chainIcons/gnosis.svg",
  },
  143: {
    chainId: 143,
    name: "Monad",
    nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
    defaultRpc: KNOWN_CHAIN_URLS[143].rpc,
    explorer: KNOWN_CHAIN_URLS[143].explorer,
    isTestnet: false,
    icon: "/chainIcons/monad.svg",
  },
  146: {
    chainId: 146,
    name: "Sonic",
    nativeCurrency: { name: "Sonic", symbol: "S", decimals: 18 },
    defaultRpc: KNOWN_CHAIN_URLS[146].rpc,
    explorer: KNOWN_CHAIN_URLS[146].explorer,
    isTestnet: false,
    icon: "/chainIcons/sonic.webp",
  },
  1155: {
    chainId: 1155,
    name: "Intuition",
    nativeCurrency: { name: "TRUST", symbol: "TRUST", decimals: 18 },
    defaultRpc: KNOWN_CHAIN_URLS[1155].rpc,
    explorer: KNOWN_CHAIN_URLS[1155].explorer,
    isTestnet: false,
  },
  1329: {
    chainId: 1329,
    name: "Sei Network",
    nativeCurrency: { name: "Sei", symbol: "SEI", decimals: 18 },
    defaultRpc: KNOWN_CHAIN_URLS[1329].rpc,
    explorer: KNOWN_CHAIN_URLS[1329].explorer,
    isTestnet: false,
    icon: "/chainIcons/sei.webp",
  },
  2020: {
    chainId: 2020,
    name: "Ronin",
    nativeCurrency: { name: "RON", symbol: "RON", decimals: 18 },
    defaultRpc: KNOWN_CHAIN_URLS[2020].rpc,
    explorer: KNOWN_CHAIN_URLS[2020].explorer,
    isTestnet: false,
    icon: "/chainIcons/ronin.webp",
  },
  4114: {
    chainId: 4114,
    name: "Citrea",
    nativeCurrency: { name: "cBTC", symbol: "cBTC", decimals: 18 },
    defaultRpc: KNOWN_CHAIN_URLS[4114].rpc,
    explorer: KNOWN_CHAIN_URLS[4114].explorer,
    isTestnet: false,
    icon: "/chainIcons/citrea.webp",
  },
  5000: {
    chainId: 5000,
    name: "Mantle",
    nativeCurrency: { name: "MNT", symbol: "MNT", decimals: 18 },
    defaultRpc: KNOWN_CHAIN_URLS[5000].rpc,
    explorer: KNOWN_CHAIN_URLS[5000].explorer,
    isTestnet: false,
    icon: "/chainIcons/mantle.svg",
  },
  42170: {
    chainId: 42170,
    name: "Arbitrum Nova",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    defaultRpc: KNOWN_CHAIN_URLS[42170].rpc,
    explorer: KNOWN_CHAIN_URLS[42170].explorer,
    isTestnet: false,
    icon: "/chainIcons/arbitrum-nova.webp",
  },
  42220: {
    chainId: 42220,
    name: "Celo",
    nativeCurrency: { name: "CELO", symbol: "CELO", decimals: 18 },
    defaultRpc: KNOWN_CHAIN_URLS[42220].rpc,
    explorer: KNOWN_CHAIN_URLS[42220].explorer,
    isTestnet: false,
    icon: "/chainIcons/celo.svg",
  },
  57073: {
    chainId: 57073,
    name: "Ink",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    defaultRpc: KNOWN_CHAIN_URLS[57073].rpc,
    explorer: KNOWN_CHAIN_URLS[57073].explorer,
    isTestnet: false,
    icon: "/chainIcons/ink.svg",
  },
  59144: {
    chainId: 59144,
    name: "Linea Mainnet",
    nativeCurrency: { name: "Linea Ether", symbol: "ETH", decimals: 18 },
    defaultRpc: KNOWN_CHAIN_URLS[59144].rpc,
    explorer: KNOWN_CHAIN_URLS[59144].explorer,
    isTestnet: false,
    icon: "/chainIcons/linea.svg",
  },
  80094: {
    chainId: 80094,
    name: "Berachain",
    nativeCurrency: { name: "BERA Token", symbol: "BERA", decimals: 18 },
    defaultRpc: KNOWN_CHAIN_URLS[80094].rpc,
    explorer: KNOWN_CHAIN_URLS[80094].explorer,
    isTestnet: false,
    icon: "/chainIcons/berachain.svg",
  },
  747474: {
    chainId: 747474,
    name: "Katana",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    defaultRpc: KNOWN_CHAIN_URLS[747474].rpc,
    explorer: KNOWN_CHAIN_URLS[747474].explorer,
    isTestnet: false,
    icon: "/chainIcons/katana.webp",
  },

  // ---------- Testnets ----------
  97: {
    chainId: 97,
    name: "BNB Smart Chain Testnet",
    nativeCurrency: { name: "BNB", symbol: "tBNB", decimals: 18 },
    defaultRpc: KNOWN_CHAIN_URLS[97].rpc,
    explorer: KNOWN_CHAIN_URLS[97].explorer,
    isTestnet: true,
  },
  1301: {
    chainId: 1301,
    name: "Unichain Sepolia",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    defaultRpc: KNOWN_CHAIN_URLS[1301].rpc,
    explorer: KNOWN_CHAIN_URLS[1301].explorer,
    isTestnet: true,
  },
  1328: {
    chainId: 1328,
    name: "Sei Testnet",
    nativeCurrency: { name: "Sei", symbol: "SEI", decimals: 18 },
    defaultRpc: KNOWN_CHAIN_URLS[1328].rpc,
    explorer: KNOWN_CHAIN_URLS[1328].explorer,
    isTestnet: true,
  },
  5003: {
    chainId: 5003,
    name: "Mantle Sepolia Testnet",
    nativeCurrency: { name: "MNT", symbol: "MNT", decimals: 18 },
    defaultRpc: KNOWN_CHAIN_URLS[5003].rpc,
    explorer: KNOWN_CHAIN_URLS[5003].explorer,
    isTestnet: true,
  },
  5115: {
    chainId: 5115,
    name: "Citrea Testnet",
    nativeCurrency: { name: "cBTC", symbol: "cBTC", decimals: 18 },
    defaultRpc: KNOWN_CHAIN_URLS[5115].rpc,
    explorer: KNOWN_CHAIN_URLS[5115].explorer,
    isTestnet: true,
  },
  6343: {
    chainId: 6343,
    name: "MegaETH Testnet",
    nativeCurrency: { name: "MegaETH Testnet Ether", symbol: "ETH", decimals: 18 },
    defaultRpc: KNOWN_CHAIN_URLS[6343].rpc,
    explorer: KNOWN_CHAIN_URLS[6343].explorer,
    isTestnet: true,
  },
  10143: {
    chainId: 10143,
    name: "Monad Testnet",
    nativeCurrency: { name: "Testnet MON Token", symbol: "MON", decimals: 18 },
    defaultRpc: KNOWN_CHAIN_URLS[10143].rpc,
    explorer: KNOWN_CHAIN_URLS[10143].explorer,
    isTestnet: true,
  },
  10200: {
    chainId: 10200,
    name: "Gnosis Chiado",
    nativeCurrency: { name: "Gnosis", symbol: "xDAI", decimals: 18 },
    defaultRpc: KNOWN_CHAIN_URLS[10200].rpc,
    explorer: KNOWN_CHAIN_URLS[10200].explorer,
    isTestnet: true,
  },
  13579: {
    chainId: 13579,
    name: "Intuition Testnet",
    nativeCurrency: { name: "TRUST", symbol: "TRUST", decimals: 18 },
    defaultRpc: KNOWN_CHAIN_URLS[13579].rpc,
    explorer: KNOWN_CHAIN_URLS[13579].explorer,
    isTestnet: true,
  },
  14601: {
    chainId: 14601,
    name: "Sonic Testnet",
    nativeCurrency: { name: "Sonic", symbol: "S", decimals: 18 },
    defaultRpc: KNOWN_CHAIN_URLS[14601].rpc,
    explorer: KNOWN_CHAIN_URLS[14601].explorer,
    isTestnet: true,
  },
  42431: {
    chainId: 42431,
    name: "Tempo Testnet (Moderato)",
    nativeCurrency: { name: "USD", symbol: "USD", decimals: 6 },
    defaultRpc: KNOWN_CHAIN_URLS[42431].rpc,
    explorer: KNOWN_CHAIN_URLS[42431].explorer,
    isTestnet: true,
  },
  59141: {
    chainId: 59141,
    name: "Linea Sepolia Testnet",
    nativeCurrency: { name: "Linea Ether", symbol: "ETH", decimals: 18 },
    defaultRpc: KNOWN_CHAIN_URLS[59141].rpc,
    explorer: KNOWN_CHAIN_URLS[59141].explorer,
    isTestnet: true,
  },
  80002: {
    chainId: 80002,
    name: "Polygon Amoy",
    nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
    defaultRpc: KNOWN_CHAIN_URLS[80002].rpc,
    explorer: KNOWN_CHAIN_URLS[80002].explorer,
    isTestnet: true,
  },
  80069: {
    chainId: 80069,
    name: "Berachain Bepolia",
    nativeCurrency: { name: "BERA Token", symbol: "BERA", decimals: 18 },
    defaultRpc: KNOWN_CHAIN_URLS[80069].rpc,
    explorer: KNOWN_CHAIN_URLS[80069].explorer,
    isTestnet: true,
  },
  84532: {
    chainId: 84532,
    name: "Base Sepolia",
    nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
    defaultRpc: KNOWN_CHAIN_URLS[84532].rpc,
    explorer: KNOWN_CHAIN_URLS[84532].explorer,
    isTestnet: true,
  },
  202601: {
    chainId: 202601,
    name: "Ronin Saigon",
    nativeCurrency: { name: "RON", symbol: "RON", decimals: 18 },
    defaultRpc: KNOWN_CHAIN_URLS[202601].rpc,
    explorer: KNOWN_CHAIN_URLS[202601].explorer,
    isTestnet: true,
  },
  421614: {
    chainId: 421614,
    name: "Arbitrum Sepolia",
    nativeCurrency: { name: "Arbitrum Sepolia Ether", symbol: "ETH", decimals: 18 },
    defaultRpc: KNOWN_CHAIN_URLS[421614].rpc,
    explorer: KNOWN_CHAIN_URLS[421614].explorer,
    isTestnet: true,
  },
  560048: {
    chainId: 560048,
    name: "Hoodi",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    defaultRpc: KNOWN_CHAIN_URLS[560048].rpc,
    explorer: KNOWN_CHAIN_URLS[560048].explorer,
    isTestnet: true,
  },
  737373: {
    chainId: 737373,
    name: "Katana Bokuto",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    defaultRpc: KNOWN_CHAIN_URLS[737373].rpc,
    explorer: KNOWN_CHAIN_URLS[737373].explorer,
    isTestnet: true,
  },
  763373: {
    chainId: 763373,
    name: "Ink Sepolia",
    nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
    defaultRpc: KNOWN_CHAIN_URLS[763373].rpc,
    explorer: KNOWN_CHAIN_URLS[763373].explorer,
    isTestnet: true,
  },
  11142220: {
    chainId: 11142220,
    name: "Celo Sepolia Testnet",
    nativeCurrency: { name: "CELO", symbol: "S-CELO", decimals: 18 },
    defaultRpc: KNOWN_CHAIN_URLS[11142220].rpc,
    explorer: KNOWN_CHAIN_URLS[11142220].explorer,
    isTestnet: true,
  },
  11155111: {
    chainId: 11155111,
    name: "Sepolia",
    nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
    defaultRpc: KNOWN_CHAIN_URLS[11155111].rpc,
    explorer: KNOWN_CHAIN_URLS[11155111].explorer,
    isTestnet: true,
  },
  11155420: {
    chainId: 11155420,
    name: "OP Sepolia",
    nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
    defaultRpc: KNOWN_CHAIN_URLS[11155420].rpc,
    explorer: KNOWN_CHAIN_URLS[11155420].explorer,
    isTestnet: true,
  },
};

export const KNOWN_CHAIN_IDS = new Set<number>(
  Object.keys(KNOWN_CHAINS).map((k) => Number(k)),
);
