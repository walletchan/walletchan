import { HardwareWalletAvatar } from "@/components/HardwareWallet/HardwareWalletAvatar";
import { KEYCARD_SHELL_HARDWARE_WALLET_BRAND } from "@/components/KeycardShell/keycardShellBrand";
import { LEDGER_HARDWARE_WALLET_BRAND } from "./ledgerBrand";

/** Official Ledger lettermark used where an address blockie would be misleading. */
export function LedgerAvatar({ size = 20, vendor }: { size?: number; vendor?: "keycardShell" }) {
  return (
    <HardwareWalletAvatar
      brand={vendor === "keycardShell" ? KEYCARD_SHELL_HARDWARE_WALLET_BRAND : LEDGER_HARDWARE_WALLET_BRAND}
      size={size}
    />
  );
}
