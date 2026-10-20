/**
 * Centralized external URLs for the extension, grouped by how they are used.
 * Service requests come first; user-opened pages, navigation, and configurable
 * chain defaults follow. Optional feature services are labelled below.
 */

// ===========================================================================
// 1. SERVICE REQUESTS — called by extension code
//
// API requests and remote assets used by wallet features. A service being listed
// here does not mean every feature or account type requires it.
// ===========================================================================

// WalletChan APIs — shared production/development origin
// Single switch for the API base. Under `pnpm dev:extension` (Vite mode ===
// "development") we point at the local Next.js dev server so any proxy route
// you're working on round-trips against `pnpm dev:website` without a deploy.
// Production builds hit walletchan.eth.sh so users on ISPs that block
// walletchan.com DNS can still use extension-backed website APIs.
//
// Port is centralised in `WALLETCHAN_DEV_PORT` — match it with the website's
// dev script (`apps/website/package.json` runs `next dev -p 3030`). When you
// need to change the port, change it here AND in that one script.
//
// Note: `import.meta.env.DEV` is NOT the right toggle — it's only true under
// the `vite` dev-server, not `vite build`. Always gate on `MODE`.
// ---------------------------------------------------------------------------
export const WALLETCHAN_DEV_PORT = 3030;
export const WALLETCHAN_SITE_HOST = "walletchan.eth.sh";
export const WALLETCHAN_SITE_URL = `https://${WALLETCHAN_SITE_HOST}`;
const WALLETCHAN_API_BASE_PROD = `${WALLETCHAN_SITE_URL}/api`;
const WALLETCHAN_API_BASE_DEV = `http://localhost:${WALLETCHAN_DEV_PORT}/api`;
export const WALLETCHAN_API_BASE =
  import.meta.env?.MODE === "development"
    ? WALLETCHAN_API_BASE_DEV
    : WALLETCHAN_API_BASE_PROD;
export const WALLETCHAN_PORTFOLIO_API = `${WALLETCHAN_API_BASE}/portfolio`;
export const WALLETCHAN_SWAP_API_BASE = `${WALLETCHAN_API_BASE}/swap`;
export const WALLETCHAN_BRIDGE_API_BASE = `${WALLETCHAN_API_BASE}/bridge`;
export const WALLETCHAN_SPONSORED_TRANSFER_API = `${WALLETCHAN_API_BASE}/sponsored-transfer`;
export const WALLETCHAN_PREMIUM_STATUS_API = `${WALLETCHAN_API_BASE}/premium-status`;
export const WALLETCHAN_VAULT_DATA_API = `${WALLETCHAN_API_BASE}/vault-data`;
export const WALLETCHAN_CLEAR_SIGNING_API = `${WALLETCHAN_API_BASE}/clearsigning/descriptor`;
export const WALLETCHAN_PIMLICO_PROXY_BASE = `${WALLETCHAN_API_BASE}/gas/pimlico`;
export const WALLETCHAN_DOMAIN_REPUTATION_API = `${WALLETCHAN_API_BASE}/domain-reputation`;

// Address labels, function signatures, and verified contract source / ABI
export const ETH_SH_LABELS_BASE = "https://eth.sh/api/labels";
export const ethShLabelsUrl = (address: string, chainId: number) =>
  `${ETH_SH_LABELS_BASE}/${address}?chainId=${chainId}`;
export const FOURBYTE_SOURCIFY_LOOKUP_URL =
  "https://api.4byte.sourcify.dev/signature-database/v1/lookup";
export const FOURBYTE_DIRECTORY_API_URL =
  "https://www.4byte.directory/api/v1/signatures/";
export const SOURCIFY_BASE = "https://sourcify.dev/server/v2/contract";

// Price data
export const COINGECKO_PRICE_API =
  "https://api.coingecko.com/api/v3/simple/price";
export const COINGECKO_TOKEN_PRICE_API =
  "https://api.coingecko.com/api/v3/simple/token_price";
/**
 * GeckoTerminal — DEX-based onchain token price feed. Used as a fallback
 * for tokens CoinGecko's `/simple/token_price` endpoint doesn't index
 * (newer / lower-cap / DEX-only tokens). Endpoint shape:
 *   /simple/networks/{network}/token_price/{addresses}
 */
export const GECKOTERMINAL_TOKEN_PRICE_API =
  "https://api.geckoterminal.com/api/v2/simple/networks";
export const COINGECKO_MARKETS_API =
  "https://api.coingecko.com/api/v3/coins/markets";
export const COINGECKO_SEARCH_API =
  "https://api.coingecko.com/api/v3/search";

// ENS history queries and dapp directory searches
export const ENS_SUBGRAPH_ID = "5XqPmWe6gjyrJtFn9cLy237i4cWw2j9HcUJEXsP5qGtH";
export const ENS_SUBGRAPH_GATEWAY_BASE = "https://gateway.thegraph.com/api";
export const ENS_SUBGRAPH_LEGACY_URL = "https://api.thegraph.com/subgraphs/name/ensdomains/ens";
export const ensSubgraphUrl = (apiKey: string) =>
  apiKey
    ? `${ENS_SUBGRAPH_GATEWAY_BASE}/${apiKey}/subgraphs/id/${ENS_SUBGRAPH_ID}`
    : ENS_SUBGRAPH_LEGACY_URL;
export const DEFILLAMA_SEARCH_URL = "https://search-core.defillama.com/multi-search";

// Safe discovery/configuration and the allowed transaction-service host
export const SAFE_CONFIG_URL = "https://safe-config.safe.global/api/v1/chains/?limit=100";
export const SAFE_TRANSACTION_SERVICE_HOST = "api.safe.global";

// Trezor Connect application identity; keep distinct from the API gateway.
export const WALLETCHAN_TREZOR_MANIFEST_URL = "https://walletchan.com";

// Bankr API — optional remote-signing/chat accounts; website links are below
export const BANKR_API_BASE = "https://api.bankr.bot";

// Privacy Pools — optional ASP and relayer services, by deployment profile
export const PRIVACY_POOLS_MAINNET_ASP_URL = "https://api.0xbow.io";
export const PRIVACY_POOLS_SEPOLIA_ASP_URL = "https://dw.0xbow.io";
export const PRIVACY_POOLS_TESTNET_RELAYER_URL = "https://testnet-relayer.privacypools.com";
export const PRIVACY_POOLS_FAST_RELAYER_URL = "https://fastrelay.xyz";
export const PRIVACY_POOLS_CLOAKED_RELAYER_URL = "https://api.clkd.xyz";

// Remote assets — icons, token images, favicons, and IPFS metadata
export const WALLETCHAN_ICON_URL = `${WALLETCHAN_SITE_URL}/images/walletchan-icon.png`;
export const googleFaviconUrl = (domain: string, size = 32) =>
  `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(`https://${domain}`)}&size=${size}`;
export const USDC_LOGO_URL =
  "https://coin-images.coingecko.com/coins/images/6319/small/usdc.png";
export const USDT_LOGO_URL = "https://coin-images.coingecko.com/coins/images/325/small/Tether.png";
export const WETH_LOGO_URL = "https://coin-images.coingecko.com/coins/images/2518/small/weth.png";
export const STETH_LOGO_URL = "https://coin-images.coingecko.com/coins/images/13442/small/steth_logo.png";
export const WSTETH_LOGO_URL = "https://coin-images.coingecko.com/coins/images/18834/small/wstETH.png";
export const METAMASK_TOKEN_ICONS_BASE = "https://static.cx.metamask.io/api/v2/tokenIcons/assets/eip155";
export const metamaskTokenIconUrl = (chainId: number, address: string) =>
  `${METAMASK_TOKEN_ICONS_BASE}/${chainId}/erc20/${address.toLowerCase()}.png`;
export const IPFS_GATEWAY = "https://ipfs.io/ipfs/";

// ===========================================================================
// 2. USER-OPENED PAGES — links for navigation, help, and external tools
//
// Opened when the user follows a link. These are not API service dependencies.
// ===========================================================================

// WalletChan pages, source, license notices, and social links
export const WALLETCHAN_STAKE_URL = `${WALLETCHAN_SITE_URL}/stake`;
export const WALLETCHAN_OS_URL = `${WALLETCHAN_SITE_URL}/os`;
export const WALLETCHAN_MIGRATE_URL = `${WALLETCHAN_SITE_URL}/migrate`;
export const WALLETCHAN_SOURCE_URL =
  "https://github.com/walletchan/walletchan";
export const WALLETCHAN_EXTENSION_LICENSE_URL =
  `${WALLETCHAN_SOURCE_URL}/blob/master/apps/extension/LICENSE.md`;
export const WALLETCHAN_THIRD_PARTY_NOTICES_URL =
  `${WALLETCHAN_SOURCE_URL}/blob/master/apps/extension/THIRD_PARTY_NOTICES.md`;
export const TWITTER_URL = "https://x.com/apoorveth";
export const WALLETCHAN_TWITTER_URL = "https://x.com/WalletChan_";

// Bankr setup and terminal pages
export const BANKR_BOT_API_PAGE = "https://bankr.bot/api";
export const BANKR_BOT_API_KEYS_PAGE = "https://bankr.bot/api-keys";
export const BANKR_BOT_TERMINAL_PAGE = "https://bankr.bot/terminal";

// Chain setup, explorers, account dashboards, and transaction tools
export const CHAINLIST_URL = "https://chainlist.org";
export const ETHERSCAN_URL = "https://etherscan.io";
export const SEPOLIA_ETHERSCAN_URL = "https://sepolia.etherscan.io";
export const BASESCAN_URL = "https://basescan.org";
export const etherscanAddressUrl = (address: string) => `${ETHERSCAN_URL}/address/${address}`;
export const DEBANK_URL = "https://debank.com";
export const NANSEN_URL = "https://app.nansen.ai";
export const OCTAV_URL = "https://pro.octav.fi";
export const ZERION_URL = "https://app.zerion.io";
export const BLOCKSCAN_URL = "https://blockscan.com";
export const TENDERLY_SIMULATOR_URL = "https://dashboard.tenderly.co/simulator/new";
export const REVOKE_CASH_URL = "https://revoke.cash";
export const revokeCashAddressUrl = (address: string) =>
  `${REVOKE_CASH_URL}/address/${encodeURIComponent(address)}`;
export const SAFE_APP_URL = "https://app.safe.global";
export const safeAppAccountUrl = (chainId: number, address: string) =>
  `${SAFE_APP_URL}/home?safe=${chainId}:${address}`;

// ENS history viewer and IPFS installation guide
export const ENS_HISTORY_BASE = "https://ens.eth.sh/history";
export const ensHistoryUrl = (name: string) => `${ENS_HISTORY_BASE}/${name.toLowerCase()}`;
export const IPFS_DESKTOP_INSTALL_URL = "https://docs.ipfs.tech/install/ipfs-desktop/";

// ===========================================================================
// 3. DAPP GATEWAYS AND LOCAL SERVICES — used for decentralized browsing
//
// Hosted gateway builders are used for navigation and favicon requests.
// Kubo is an optional user-run loopback service, not a public wallet API.
// ===========================================================================

// Hosted name gateways — preserve callers' casing and paths
export const ENS_LIMO_SUFFIX = "limo";
export const ENS_LINK_SUFFIX = "link";
export const GNS_GATEWAY_SUFFIX = "domains";
export const WEB3_GATEWAY_HOST = "w3eth.io";
export const ensLimoUrl = (name: string) => `https://${name}.${ENS_LIMO_SUFFIX}`;
export const ensLinkUrl = (name: string) => `https://${name}.${ENS_LINK_SUFFIX}`;
export const gnsGatewayUrl = (name: string) => `https://${name}.${GNS_GATEWAY_SUFFIX}`;
export const web3GatewayUrl = (label: string) => `https://${label}.${WEB3_GATEWAY_HOST}`;

// Local Kubo API and default gateway origin
export const KUBO_API_BASE = "http://127.0.0.1:5001";
export const KUBO_DEFAULT_GATEWAY_ORIGIN = "http://localhost:8080";

// ===========================================================================
// 4. RPC DEFAULTS AND RECOVERY — blockchain access, separate from wallet APIs
//
// Built-in and suggested custom-chain RPCs can be replaced in network settings.
// Explorer URLs are user-opened links. Recovery RPCs below are called directly
// by the extension and retain their fixed fallback order.
// ===========================================================================

// Fixed RPC fallbacks for L1 force inclusion and sponsored-transfer recovery
export const SEPOLIA_FALLBACK_RPC_URL = "https://ethereum-sepolia-rpc.publicnode.com";
export const BASE_RECONCILIATION_RPCS = [
  "https://mainnet.base.org",
  "https://base.drpc.org",
] as const;

// Retired shipped defaults recognized only for exact legacy-default upgrades.
export const RETIRED_SEPOLIA_RPC_URL = "https://sepolia.drpc.org";

// Built-in chain endpoints; chainRegistry.ts owns capabilities and metadata.
export const BUILT_IN_CHAIN_URLS = {
  1: { rpc: "https://eth.drpc.org", explorer: ETHERSCAN_URL },
  2741: { rpc: "https://api.mainnet.abs.xyz", explorer: "https://abscan.org" },
  42161: { rpc: "https://arb1.arbitrum.io/rpc", explorer: "https://arbiscan.io" },
  43114: { rpc: "https://api.avax.network/ext/bc/C/rpc", explorer: "https://snowtrace.io" },
  8453: { rpc: BASE_RECONCILIATION_RPCS[1], explorer: BASESCAN_URL },
  80094: { rpc: "https://rpc.berachain.com", explorer: "https://berascan.com" },
  81457: { rpc: "https://rpc.blast.io", explorer: "https://blastscan.io" },
  56: { rpc: "https://bsc-dataseed.binance.org", explorer: "https://bscscan.com" },
  999: { rpc: "https://rpc.hyperliquid.xyz/evm", explorer: "https://hyperevmscan.io" },
  57073: { rpc: "https://rpc-gel.inkonchain.com", explorer: "https://explorer.inkonchain.com" },
  59144: { rpc: "https://rpc.linea.build", explorer: "https://lineascan.build" },
  5000: { rpc: "https://rpc.mantle.xyz", explorer: "https://mantlescan.xyz" },
  10: { rpc: "https://mainnet.optimism.io", explorer: "https://optimistic.etherscan.io" },
  4326: { rpc: "https://mainnet.megaeth.com/rpc", explorer: "https://mega.etherscan.io" },
  34443: { rpc: "https://mainnet.mode.network", explorer: "https://explorer.mode.network" },
  143: { rpc: "https://rpc.monad.xyz", explorer: "https://monadscan.com" },
  9745: { rpc: "https://rpc.plasma.to", explorer: "https://plasmascan.to" },
  137: { rpc: "https://polygon.drpc.org", explorer: "https://polygonscan.com" },
  4663: { rpc: "https://rpc.mainnet.chain.robinhood.com", explorer: "https://robinhoodchain.blockscout.com" },
  534352: { rpc: "https://rpc.scroll.io", explorer: "https://scrollscan.com" },
  146: { rpc: "https://rpc.soniclabs.com", explorer: "https://sonicscan.org" },
  4217: { rpc: "https://rpc.presto.tempo.xyz", explorer: "https://explore.mainnet.tempo.xyz" },
  130: { rpc: "https://mainnet.unichain.org", explorer: "https://uniscan.xyz" },
  480: { rpc: "https://worldchain-mainnet.g.alchemy.com/public", explorer: "https://worldscan.org" },
  324: { rpc: "https://mainnet.era.zksync.io", explorer: "https://explorer.zksync.io" },
  11155111: { rpc: "https://sepolia.drpc.org", explorer: SEPOLIA_ETHERSCAN_URL },
  560048: { rpc: "https://rpc.hoodi.ethpandaops.io", explorer: "https://hoodi.etherscan.io" },
  11124: { rpc: "https://api.testnet.abs.xyz", explorer: "https://sepolia.abscan.org" },
  421614: { rpc: "https://arbitrum-sepolia.drpc.org", explorer: "https://sepolia.arbiscan.io" },
  43113: { rpc: "https://avalanche-fuji.drpc.org", explorer: "https://testnet.snowscan.xyz" },
  84532: { rpc: "https://base-sepolia.drpc.org", explorer: "https://sepolia.basescan.org" },
  80069: { rpc: "https://bepolia.rpc.berachain.com", explorer: "https://bepolia.beratrail.io" },
  168587773: { rpc: "https://blast-sepolia.drpc.org", explorer: "https://testnet.blastscan.io" },
  97: { rpc: "https://bsc-testnet.drpc.org", explorer: "https://testnet.bscscan.com" },
  998: { rpc: "https://rpc.hyperliquid-testnet.xyz/evm", explorer: "https://testnet.hyperscan.com" },
  763373: { rpc: "https://rpc-gel-sepolia.inkonchain.com", explorer: "https://explorer-sepolia.inkonchain.com" },
  59141: { rpc: "https://linea-sepolia.drpc.org", explorer: "https://sepolia.lineascan.build" },
  5003: { rpc: "https://mantle-sepolia.drpc.org", explorer: "https://explorer.sepolia.mantle.xyz" },
  11155420: { rpc: "https://optimism-sepolia.drpc.org", explorer: "https://sepolia-optimism.etherscan.io" },
  6343: { rpc: "https://carrot.megaeth.com/rpc", explorer: "https://testnet-mega.etherscan.io" },
  919: { rpc: "https://sepolia.mode.network", explorer: "https://testnet.modescan.io" },
  10143: { rpc: "https://testnet-rpc.monad.xyz", explorer: "https://testnet.monadexplorer.com" },
  9746: { rpc: "https://testnet-rpc.plasma.to", explorer: "https://testnet.plasmascan.to" },
  80002: { rpc: "https://polygon-amoy.drpc.org", explorer: "https://amoy.polygonscan.com" },
  46630: { rpc: "https://rpc.testnet.chain.robinhood.com/rpc", explorer: "https://explorer.testnet.chain.robinhood.com" },
  534351: { rpc: "https://scroll-sepolia.drpc.org", explorer: "https://sepolia.scrollscan.com" },
  14601: { rpc: "https://rpc.testnet.soniclabs.com", explorer: "https://explorer.testnet.soniclabs.com" },
  42431: { rpc: "https://rpc.moderato.tempo.xyz", explorer: "https://explore.testnet.tempo.xyz" },
  1301: { rpc: "https://unichain-sepolia.drpc.org", explorer: "https://sepolia.uniscan.xyz" },
  4801: { rpc: "https://worldchain-sepolia.drpc.org", explorer: "https://sepolia.worldscan.org" },
  300: { rpc: "https://zksync-sepolia.drpc.org", explorer: "https://sepolia.explorer.zksync.io" },
} as const;

// BEGIN GENERATED KNOWN CHAIN URLS (pnpm regen-chains)
export const KNOWN_CHAIN_URLS = {
  100: { rpc: "https://gnosis.drpc.org", explorer: "https://gnosisscan.io" },
  143: { rpc: "https://monad.drpc.org", explorer: "https://monadscan.com" },
  146: { rpc: "https://sonic.drpc.org", explorer: "https://sonicscan.org" },
  1155: { rpc: "https://rpc.intuition.systems", explorer: "https://explorer.intuition.systems" },
  1329: { rpc: "https://sei.drpc.org", explorer: "https://seitrace.com" },
  2020: { rpc: "https://ronin.drpc.org", explorer: "https://app.roninchain.com" },
  4114: { rpc: "https://rpc.citrea.xyz", explorer: "https://explorer.citrea.xyz" },
  5000: { rpc: "https://mantle.drpc.org", explorer: "https://mantlescan.xyz/" },
  42170: { rpc: "https://arbitrum-nova.drpc.org", explorer: "https://nova.arbiscan.io" },
  42220: { rpc: "https://celo.drpc.org", explorer: "https://celoscan.io" },
  57073: { rpc: "https://ink.drpc.org", explorer: "https://explorer.inkonchain.com" },
  59144: { rpc: "https://linea.drpc.org", explorer: "https://lineascan.build" },
  80094: { rpc: "https://berachain.drpc.org", explorer: "https://berascan.com" },
  747474: { rpc: "https://katana.drpc.org", explorer: "https://katanascan.com" },
  97: { rpc: "https://data-seed-prebsc-1-s1.bnbchain.org:8545", explorer: "https://testnet.bscscan.com" },
  1301: { rpc: "https://sepolia.unichain.org", explorer: "https://sepolia.uniscan.xyz" },
  1328: { rpc: "https://evm-rpc-testnet.sei-apis.com", explorer: "https://seitrace.com" },
  5003: { rpc: "https://rpc.sepolia.mantle.xyz", explorer: "https://explorer.sepolia.mantle.xyz/" },
  5115: { rpc: "https://rpc.testnet.citrea.xyz", explorer: "https://explorer.testnet.citrea.xyz" },
  6343: { rpc: "https://carrot.megaeth.com/rpc", explorer: "https://www.megaexplorer.xyz/" },
  10143: { rpc: "https://testnet-rpc.monad.xyz", explorer: "https://testnet.monadexplorer.com" },
  10200: { rpc: "https://rpc.chiadochain.net", explorer: "https://blockscout.chiadochain.net" },
  13579: { rpc: "https://testnet.rpc.intuition.systems", explorer: "https://testnet.explorer.intuition.systems" },
  14601: { rpc: "https://rpc.testnet.soniclabs.com", explorer: "https://testnet.sonicscan.org" },
  42431: { rpc: "https://rpc.moderato.tempo.xyz", explorer: "https://explore.moderato.tempo.xyz" },
  59141: { rpc: "https://rpc.sepolia.linea.build", explorer: "https://sepolia.lineascan.build" },
  80002: { rpc: "https://rpc-amoy.polygon.technology", explorer: "https://amoy.polygonscan.com" },
  80069: { rpc: "https://bepolia.rpc.berachain.com", explorer: "https://bepolia.beratrail.io" },
  84532: { rpc: "https://sepolia.base.org", explorer: "https://sepolia.basescan.org" },
  202601: { rpc: "https://saigon-testnet.roninchain.com/rpc", explorer: "https://saigon-explorer.roninchain.com" },
  421614: { rpc: "https://sepolia-rollup.arbitrum.io/rpc", explorer: "https://sepolia.arbiscan.io" },
  560048: { rpc: "https://rpc.hoodi.ethpandaops.io", explorer: "https://hoodi.etherscan.io" },
  737373: { rpc: "https://rpc.bokuto.katanarpc.com", explorer: "https://bokuto.katanascan.com" },
  763373: { rpc: "https://rpc-gel-sepolia.inkonchain.com", explorer: "https://explorer-sepolia.inkonchain.com/" },
  11142220: { rpc: "https://forno.celo-sepolia.celo-testnet.org", explorer: "https://celo-sepolia.blockscout.com/" },
  11155111: { rpc: "https://11155111.rpc.thirdweb.com", explorer: SEPOLIA_ETHERSCAN_URL },
  11155420: { rpc: "https://sepolia.optimism.io", explorer: "https://optimism-sepolia.blockscout.com" },
} as const;
// END GENERATED KNOWN CHAIN URLS
