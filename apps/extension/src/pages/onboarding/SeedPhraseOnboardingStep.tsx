import { Box, Flex } from "@chakra-ui/react";
import { useState } from "react";
import SeedPhraseSetup from "@/components/SeedPhraseSetup";
import { OnboardingFrame, OnboardingHeader } from "./OnboardingShell";

export function SeedPhraseOnboardingStep({
  onBack,
  onProgressStepClick,
  onCollect,
}: {
  onBack: () => void;
  onProgressStepClick: (step: number) => void;
  onCollect: (
    mnemonic: string,
    indices: number[],
    groupName?: string,
    accountDisplayName?: string,
  ) => void;
}) {
  const [isImportView, setIsImportView] = useState(true);
  return (
    <OnboardingFrame currentStep={1} onStepClick={onProgressStepClick}>
      {isImportView && <OnboardingHeader onBack={onBack} step={1} />}
      <Flex flex="1" minH={0} overflowY="auto" justify="center">
        <Box
          w="full"
          maxW="656px"
          px={{ base: 5, sm: 7 }}
          pt={6}
          pb={6}
          position="relative"
        >
          <Box>
            <SeedPhraseSetup
              initialMode="import"
              onImportViewChange={setIsImportView}
              onBack={onBack}
              onComplete={() => {}}
              onCollect={onCollect}
            />
          </Box>
        </Box>
      </Flex>
    </OnboardingFrame>
  );
}
