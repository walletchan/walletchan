import { HardwareWalletAvatar } from "@/components/HardwareWallet/HardwareWalletAvatar";
import { LEDGER_HARDWARE_WALLET_BRAND } from "./ledgerBrand";

/** Official Ledger lettermark used where an address blockie would be misleading. */
export function LedgerAvatar({ size = 20 }: { size?: number }) {
  return (
    <HardwareWalletAvatar
      brand={LEDGER_HARDWARE_WALLET_BRAND}
      size={size}
    />
  );
}
