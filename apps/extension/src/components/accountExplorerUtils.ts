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

export function getDefaultAccountExplorerUrl(address: string): string {
  return `${ETHERSCAN_URL}/address/${address}`;
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
