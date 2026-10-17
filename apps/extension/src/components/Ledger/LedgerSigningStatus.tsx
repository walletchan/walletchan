import { HardwareWalletSigningStatus } from "@/components/HardwareWallet/HardwareWalletSigningStatus";
import { LEDGER_HARDWARE_WALLET_BRAND } from "./ledgerBrand";

/** Keeps the hardware action visible without replacing the request review. */
export function LedgerSigningStatus({ active }: { active: boolean }) {
  return (
    <HardwareWalletSigningStatus
      active={active}
      brand={LEDGER_HARDWARE_WALLET_BRAND}
      message="Sign the request in your Ledger"
    />
  );
}
