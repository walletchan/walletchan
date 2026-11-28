import { BUNKER_ONBOARDING_STEPS } from "./onboardingTypes";
import { useState } from "react";
import { Text, VStack } from "@chakra-ui/react";
import type { SeedGroup } from "@/chrome/types";
import { BunkerExistingImport } from "@/components/SafeBunker/BunkerExistingImport";
import { useBunkerDiscovery } from "@/components/SafeBunker/useBunkerDiscovery";
import { OnboardingCanvas, OnboardingHeader } from "./OnboardingShell";

export function BunkerOnboardingDiscoveryStep({ group, onBack, onAdded }: {
  group: SeedGroup; onBack: () => void; onAdded: (accountId: string, chainId: number) => void;
}) {
  const discovery = useBunkerDiscovery(group.id);
  const [busy, setBusy] = useState(false), [committed, setCommitted] = useState(false);
  return <OnboardingCanvas steps={BUNKER_ONBOARDING_STEPS} currentStep={3} header={<OnboardingHeader totalSteps={4} step={3} onBack={busy || committed ? undefined : onBack} />}>
    <VStack align="stretch" spacing={5}>
      <Text as="h1" fontSize="2xl" fontWeight="700" letterSpacing="-0.02em">Import Safe Bunkers</Text>
      <Text fontSize="sm" color="fg.secondary">Select the existing Bunkers you want to restore.</Text>
      <BunkerExistingImport seedGroupId={group.id} discovery={discovery} autoSearch onAdded={onAdded} onBusyChange={setBusy} onCommitted={() => setCommitted(true)} />
    </VStack>
  </OnboardingCanvas>;
}
