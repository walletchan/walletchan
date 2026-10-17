import type { HardwareWalletBrand } from "@/components/HardwareWallet/types";

export const KEYCARD_SHELL_HARDWARE_WALLET_BRAND = {
  name: "Keycard Shell",
  // shortcut: neutral device glyph; swap for Keycard's official marks before release.
  logoAssets: { lettermark: "/keycard-shell-mark.svg", wordmark: "/keycard-shell-mark.svg" },
  logoAspectRatios: { lettermark: 1, wordmark: 1 },
} satisfies HardwareWalletBrand;
