import AddHardwareWalletFlow from "@/components/HardwareWallet/AddHardwareWalletFlow";
import { HardwareWalletSetupShell } from "@/components/HardwareWallet/HardwareWalletSetupShell";
import { keycardShellHardwareWalletProvider } from "./keycardShellFlowAdapter";

export default function KeycardShellSetupScreen({
  onBack,
  onComplete,
}: {
  onBack: () => void;
  onComplete: () => Promise<void>;
}) {
  return (
    <HardwareWalletSetupShell>
      <AddHardwareWalletFlow
        provider={keycardShellHardwareWalletProvider}
        onBack={onBack}
        onComplete={onComplete}
      />
    </HardwareWalletSetupShell>
  );
}
