import type { PortfolioToken } from "@/chrome/portfolio/api";
import { getNativeAssetMeta } from "@/lib/chains";
import type { NetworksInfo } from "@/types";

export const HOME_SEND_CHAIN_ID = 1;

/** Resolve the initial Send selection without coupling it to homepage chain state. */
export function resolveSendEntryToken(
  clickedToken: PortfolioToken | null,
  networksInfo?: NetworksInfo,
  defaultChainId = HOME_SEND_CHAIN_ID,
): PortfolioToken {
  if (clickedToken) return clickedToken;

  const native = getNativeAssetMeta(defaultChainId, networksInfo);
  return {
    contractAddress: "native",
    chainId: defaultChainId,
    name: native?.name ?? "Ether",
    symbol: native?.symbol ?? "ETH",
    decimals: native?.decimals ?? 18,
    logoUrl: native?.logoUrl,
    balance: "0",
    balanceFormatted: "0",
    priceUsd: 0,
    valueUsd: 0,
  };
}
