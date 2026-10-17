import type { HardwareWalletBrand } from "@/components/HardwareWallet/types";

export const LEDGER_HARDWARE_WALLET_BRAND = {
  name: "Ledger",
  logoAssets: {
    lettermark: "/ledger-lettermark.svg",
    wordmark: "/ledger-wordmark.svg",
  },
  logoAspectRatios: {
    lettermark: 768.91 / 669.35,
    wordmark: 2000.58 / 669.35,
  },
} satisfies HardwareWalletBrand;
