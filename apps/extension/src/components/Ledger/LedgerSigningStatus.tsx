import { HardwareWalletSigningStatus } from "@/components/HardwareWallet/HardwareWalletSigningStatus";
import { KEYCARD_SHELL_HARDWARE_WALLET_BRAND } from "@/components/KeycardShell/keycardShellBrand";
import { LEDGER_HARDWARE_WALLET_BRAND } from "./ledgerBrand";

/** Keeps the hardware action visible without replacing the request review. */
export function LedgerSigningStatus({ active, vendor }: { active: boolean; vendor?: "keycardShell" }) {
  const brand = vendor === "keycardShell" ? KEYCARD_SHELL_HARDWARE_WALLET_BRAND : LEDGER_HARDWARE_WALLET_BRAND;
  return (
    <HardwareWalletSigningStatus
      active={active}
      brand={brand}
      message={vendor === "keycardShell" ? "Sign the request in your Keycard Shell" : "Sign the request in your Ledger"}
    />
  );
}
