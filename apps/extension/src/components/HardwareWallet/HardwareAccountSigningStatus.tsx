import { LedgerSigningStatus } from "@/components/Ledger/LedgerSigningStatus";
import { TrezorSigningStatus } from "@/components/Trezor/TrezorSigningStatus";

export function HardwareAccountSigningStatus({
  accountType,
  active,
  vendor,
}: {
  accountType?: string;
  active: boolean;
  vendor?: "keycardShell";
}) {
  if (accountType === "ledger") {
    return <LedgerSigningStatus active={active} vendor={vendor} />;
  }
  if (accountType !== "trezor") return null;
  return <TrezorSigningStatus active={active} />;
}
