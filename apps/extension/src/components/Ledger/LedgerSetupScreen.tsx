import { HardwareWalletSetupShell } from "@/components/HardwareWallet/HardwareWalletSetupShell";
import AddLedgerFlow from "./AddLedgerFlow";

export default function LedgerSetupScreen({
  onBack,
  onComplete,
}: {
  onBack: () => void;
  onComplete: () => Promise<void>;
}) {
  return (
    <HardwareWalletSetupShell>
      <AddLedgerFlow onBack={onBack} onComplete={onComplete} />
    </HardwareWalletSetupShell>
  );
}
