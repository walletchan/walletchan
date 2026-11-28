import { Box, Flex, Text } from "@chakra-ui/react";
import { BUNKER_ONBOARDING_STEPS } from "./onboardingTypes";
import { useState } from "react";
import SeedPhraseSetup from "@/components/SeedPhraseSetup";
import { BunkerSetupIntro } from "@/components/SafeBunker/BunkerSetupIntro";
import { OnboardingFrame, OnboardingHeader } from "./OnboardingShell";

export function SeedPhraseOnboardingStep({
  phraseOnly = false, error,
  onBack,
  onProgressStepClick,
  onCollect,
}: {
  phraseOnly?: boolean; error?: string;
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
  const [showBunkerIntro, setShowBunkerIntro] = useState(phraseOnly && !error);
  const handleBack = () => phraseOnly ? setShowBunkerIntro(true) : onBack();
  if (showBunkerIntro) return (
    <OnboardingFrame steps={BUNKER_ONBOARDING_STEPS} currentStep={1} onStepClick={onProgressStepClick}>
      <BunkerSetupIntro onBack={onBack} onProceed={() => setShowBunkerIntro(false)} />
    </OnboardingFrame>
  );
  return (
    <OnboardingFrame steps={phraseOnly ? BUNKER_ONBOARDING_STEPS : undefined} currentStep={1} onStepClick={onProgressStepClick}>
      {isImportView && <OnboardingHeader totalSteps={phraseOnly ? 4 : 3} onBack={handleBack} step={1} />}
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
            {error && <Text role="alert" fontSize="sm" color="status.error.emphasis" mb={4}>{error}</Text>}
            <SeedPhraseSetup phraseOnly={phraseOnly}
              initialMode="import"
              onImportViewChange={setIsImportView}
              onBack={handleBack}
              onComplete={() => {}}
              onCollect={onCollect}
            />
          </Box>
        </Box>
      </Flex>
    </OnboardingFrame>
  );
}
