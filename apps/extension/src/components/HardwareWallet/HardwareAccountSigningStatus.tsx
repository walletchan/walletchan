import { LedgerSigningStatus } from "@/components/Ledger/LedgerSigningStatus";
import { TrezorSigningStatus } from "@/components/Trezor/TrezorSigningStatus";

export function HardwareAccountSigningStatus({
  accountType,
  active,
}: {
  accountType?: string;
  active: boolean;
}) {
  if (accountType === "ledger") {
    return <LedgerSigningStatus active={active} />;
  }
  if (accountType !== "trezor") return null;
  return <TrezorSigningStatus active={active} />;
}
