import { Box, Text, VStack } from "@chakra-ui/react";
import AddLatticeFlow from "@/components/Lattice/AddLatticeFlow";
import type { HardwareWalletAccountSelection } from "@/components/HardwareWallet/types";
import {
  OnboardingCanvas,
  OnboardingFooter,
  OnboardingHeader,
} from "./OnboardingShell";

/**
 * Lattice twin of LedgerOnboardingStep: the same onboarding layout as
 * HardwareWalletOnboardingStep, around AddLatticeFlow so the connection form
 * (device ID, optional endpoint, pairing code) stays in place.
 */
export function LatticeOnboardingStep({
  onBack,
  onProgressStepClick,
  onCollect,
}: {
  onBack: () => void;
  onProgressStepClick: (step: number) => void;
  onCollect: (selection: HardwareWalletAccountSelection) => Promise<void>;
}) {
  return (
    <AddLatticeFlow
      showDevicePanelHeading={false}
      onBack={onBack}
      onComplete={() => undefined}
      commitAccounts={onCollect}
      renderLayout={({ content, primaryAction }) => (
        <OnboardingCanvas
          currentStep={1}
          onStepClick={onProgressStepClick}
          header={<OnboardingHeader onBack={onBack} step={1} />}
          footer={
            <OnboardingFooter>
              <Box sx={{ "& > button": { width: "100%" } }}>
                {primaryAction}
              </Box>
            </OnboardingFooter>
          }
        >
          <VStack align="stretch" spacing={6}>
            <VStack align="stretch" spacing={1.5}>
              <Text
                as="h1"
                fontSize="2xl"
                fontWeight="700"
                letterSpacing="-0.02em"
              >
                Connect your Lattice
              </Text>
            </VStack>
            {content}
          </VStack>
        </OnboardingCanvas>
      )}
    />
  );
}
