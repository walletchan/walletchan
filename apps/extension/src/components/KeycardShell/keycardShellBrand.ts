import type { HardwareWalletBrand } from "@/components/HardwareWallet/types";

// Official Keycard marks, used with Keycard's permission (brand kit, 2026-10-19).
export const KEYCARD_SHELL_HARDWARE_WALLET_BRAND = {
  name: "Keycard Shell",
  logoAssets: {
    lettermark: "/keycard-shell-symbol.svg",
    wordmark: "/keycard-shell-wordmark.svg",
  },
  logoAspectRatios: {
    lettermark: 100.2 / 174.3,
    wordmark: 488 / 205,
  },
} satisfies HardwareWalletBrand;
