import { HardwareWalletSetupShell } from "@/components/HardwareWallet/HardwareWalletSetupShell";
import AddLatticeFlow from "./AddLatticeFlow";

export default function LatticeSetupScreen({
  onBack,
  onComplete,
}: {
  onBack: () => void;
  onComplete: () => Promise<void>;
}) {
  return (
    <HardwareWalletSetupShell>
      <AddLatticeFlow onBack={onBack} onComplete={onComplete} />
    </HardwareWalletSetupShell>
  );
}
