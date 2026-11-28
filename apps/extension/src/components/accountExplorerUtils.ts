import type { Account } from "@/chrome/types";
import type { NetworksInfo } from "@/types";
import { getResolvedChainById } from "@/lib/chains";
import {
  ETHERSCAN_URL,
  DEBANK_URL,
  NANSEN_URL,
  OCTAV_URL,
  ZERION_URL,
  BLOCKSCAN_URL,
} from "@/constants/externalUrls";

export interface AccountDashboardLink {
  name: string;
  iconSrc: string;
  href: string;
}

export function getDefaultAccountExplorerUrl(address: string, explorer = ETHERSCAN_URL): string {
  return `${explorer.replace(/\/+$/, "")}/address/${address}`;
}

/** Bunker addresses belong only to their bound chain; never fall back to L1. */
export function getAccountExplorerUrl(account: Account, networksInfo?: NetworksInfo): string | undefined {
  if (account.type !== "safeBunker") return getDefaultAccountExplorerUrl(account.address);
  const explorer = getResolvedChainById(account.chainId, networksInfo)?.explorer;
  return explorer ? getDefaultAccountExplorerUrl(account.address, explorer) : undefined;
}

export function getAccountDashboardLinks(
  address: string,
): AccountDashboardLink[] {
  const encodedAddress = encodeURIComponent(address);

  return [
    {
      name: "DeBank",
      iconSrc: "/debank-icon.ico",
      href: `${DEBANK_URL}/profile/${encodedAddress}`,
    },
    {
      name: "Nansen",
      iconSrc: "/nansen-icon.png",
      href: `${NANSEN_URL}/address/${encodedAddress}`,
    },
    {
      name: "Octav",
      iconSrc: "/octav-icon.png",
      href: `${OCTAV_URL}/?addresses=${encodedAddress}`,
    },
    {
      name: "Zerion",
      iconSrc: "/zerion-icon.png",
      href: `${ZERION_URL}/${encodedAddress}/overview`,
    },
    {
      name: "Blockscan",
      iconSrc: "/blockscan-icon.png",
      href: `${BLOCKSCAN_URL}/address/${encodedAddress}`,
    },
  ];
}
