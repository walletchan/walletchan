import { type BoxProps } from "@chakra-ui/react";
import { HardwareWalletLogo } from "@/components/HardwareWallet/HardwareWalletLogo";
import type { HardwareWalletLogoVariant } from "@/components/HardwareWallet/types";
import { TREZOR_HARDWARE_WALLET_BRAND } from "./trezorBrand";

export function TrezorLogo({
  variant = "wordmark",
  ...props
}: BoxProps & { variant?: HardwareWalletLogoVariant }) {
  return (
    <HardwareWalletLogo
      brand={TREZOR_HARDWARE_WALLET_BRAND}
      variant={variant}
      {...props}
    />
  );
}
