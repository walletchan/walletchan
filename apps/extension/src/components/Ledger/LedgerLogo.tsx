import type { BoxProps } from "@chakra-ui/react";
import { HardwareWalletLogo } from "@/components/HardwareWallet/HardwareWalletLogo";
import type { HardwareWalletLogoVariant } from "@/components/HardwareWallet/types";
import { LEDGER_HARDWARE_WALLET_BRAND } from "./ledgerBrand";

/** Official Ledger brand mark, colored through the active WalletChan theme. */
export function LedgerLogo({
  variant = "wordmark",
  ...props
}: BoxProps & { variant?: HardwareWalletLogoVariant }) {
  return (
    <HardwareWalletLogo
      brand={LEDGER_HARDWARE_WALLET_BRAND}
      variant={variant}
      {...props}
    />
  );
}
