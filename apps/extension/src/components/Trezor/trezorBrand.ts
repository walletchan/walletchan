import type { HardwareWalletBrand } from "@/components/HardwareWallet/types";

export const TREZOR_HARDWARE_WALLET_BRAND = {
  name: "Trezor",
  logoAssets: {
    lettermark: "/trezor-symbol.svg",
    wordmark: "/trezor-wordmark.svg",
  },
  logoAspectRatios: {
    lettermark: 260.73 / 378.41,
    wordmark: 1482.08 / 378.41,
  },
} satisfies HardwareWalletBrand;
