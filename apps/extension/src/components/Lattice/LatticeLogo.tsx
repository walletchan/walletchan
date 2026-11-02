import type { BoxProps } from "@chakra-ui/react";
import { HardwareWalletLogo } from "@/components/HardwareWallet/HardwareWalletLogo";
import type { HardwareWalletLogoVariant } from "@/components/HardwareWallet/types";
import { LATTICE_HARDWARE_WALLET_BRAND } from "./latticeBrand";

/** Lattice mark, colored through the active WalletChan theme. */
export function LatticeLogo({
  variant = "wordmark",
  ...props
}: BoxProps & { variant?: HardwareWalletLogoVariant }) {
  return (
    <HardwareWalletLogo
      brand={LATTICE_HARDWARE_WALLET_BRAND}
      variant={variant}
      {...props}
    />
  );
}
