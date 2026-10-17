import { HardwareWalletDerivationPicker } from "@/components/HardwareWallet/HardwareWalletDerivationPicker";
import {
  LEDGER_DERIVATION_OPTIONS,
  type LedgerDerivationScheme,
} from "./ledgerDerivation";

export type { LedgerDerivationScheme } from "./ledgerDerivation";

export function LedgerDerivationPicker({
  value,
  onChange,
}: {
  value: LedgerDerivationScheme;
  onChange(value: LedgerDerivationScheme): void;
}) {
  return (
    <HardwareWalletDerivationPicker
      value={value}
      onChange={onChange}
      options={LEDGER_DERIVATION_OPTIONS}
    />
  );
}
