import type { TrezorAccountSelection } from "@/components/Trezor/AddTrezorFlow";
import { trezorHardwareWalletProvider } from "@/components/Trezor/trezorFlowAdapter";
import { HardwareWalletOnboardingStep } from "./HardwareWalletOnboardingStep";

export function TrezorOnboardingStep({
  onBack,
  onProgressStepClick,
  onCollect,
}: {
  onBack: () => void;
  onProgressStepClick: (step: number) => void;
  onCollect: (selection: TrezorAccountSelection) => Promise<void>;
}) {
  return (
    <HardwareWalletOnboardingStep
      provider={trezorHardwareWalletProvider}
      onBack={onBack}
      onProgressStepClick={onProgressStepClick}
      onCollect={onCollect}
    />
  );
}
