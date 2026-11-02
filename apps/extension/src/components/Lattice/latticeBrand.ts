import type { HardwareWalletBrand } from "@/components/HardwareWallet/types";

/** Neutral, font-free Lattice marks generated for WalletChan (not GridPlus artwork). */
export const LATTICE_HARDWARE_WALLET_BRAND = {
  name: "Lattice",
  logoAssets: {
    lettermark: "/lattice-lettermark.svg",
    wordmark: "/lattice-wordmark.svg",
  },
  logoAspectRatios: {
    lettermark: 1,
    wordmark: 470 / 70,
  },
} satisfies HardwareWalletBrand;
