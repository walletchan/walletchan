import { HardwareWalletSetupShell } from "@/components/HardwareWallet/HardwareWalletSetupShell";
import AddTrezorFlow from "./AddTrezorFlow";

export default function TrezorSetupScreen({
  onBack,
  onComplete,
}: {
  onBack: () => void;
  onComplete: () => Promise<void>;
}) {
  return (
    <HardwareWalletSetupShell>
      <AddTrezorFlow onBack={onBack} onComplete={onComplete} />
    </HardwareWalletSetupShell>
  );
}
