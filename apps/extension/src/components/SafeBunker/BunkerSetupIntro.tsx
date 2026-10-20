import { ArrowForwardIcon, LockIcon, RepeatIcon } from "@chakra-ui/icons";
import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { AppHeader, AppScreen, ScreenBody, StickyActionBar } from "@/components/ui";
import { KeyIcon, SafeIcon, SeedIcon } from "@/components/shared/AccountTypeIcons";

export function BunkerSetupIntro({ onBack, onProceed }: { onBack: () => void; onProceed: () => void }) {
  return <AppScreen>
    <AppHeader title="Safe Bunker" onBack={onBack} />
    <ScreenBody pt={6}>
      <VStack align="stretch" spacing={6}>
        <VStack spacing={3} py={4}>
          <Box p={4} borderRadius="lg" bg="surface.raised" color="accent.highlight"><SafeIcon boxSize={10} /></Box>
          <Text fontSize="xl" fontWeight="700" textAlign="center">One Address. New owner with every transaction.</Text>
          <Text fontSize="sm" color="fg.secondary" textAlign="center">Each EOA signer only signs once</Text>
        </VStack>
        <Box p={4} bg="surface.raised" border="1px solid" borderColor="border.subtle" borderRadius="lg" role="img" aria-label="Each transaction replaces the current signing owner with the next owner from your recovery phrase">
          <HStack justify="space-between" spacing={2}>
            <VStack spacing={2} flex={1}><LockIcon boxSize={5} color="fg.secondary" /><Text fontSize="xs" fontWeight="600">Owner #1</Text></VStack>
            <VStack spacing={1}><ArrowForwardIcon boxSize={5} color="accent.highlight" /><Text fontSize="2xs" color="fg.secondary">Transaction</Text></VStack>
            <VStack spacing={2} flex={1}><RepeatIcon boxSize={5} color="accent.highlight" /><Text fontSize="xs" fontWeight="600">Owner #2</Text></VStack>
          </HStack>
        </Box>
        <VStack align="stretch" spacing={3}>
          <HStack spacing={3}><Box p={2} bg="surface.raised" borderRadius="md" color="fg.secondary"><KeyIcon boxSize={4} aria-hidden="true" /></Box><Text fontSize="sm" color="fg.secondary" fontWeight="500">One recovery phrase</Text></HStack>
          <HStack spacing={3}><Box p={2} bg="surface.raised" borderRadius="md" color="fg.secondary"><SeedIcon boxSize={4} aria-hidden="true" /></Box><Text fontSize="sm" color="fg.secondary" fontWeight="500">Gas paid by another account</Text></HStack>
        </VStack>
        <Text fontSize="xs" color="fg.muted">A separate Safe Bunker account for each network</Text>
      </VStack>
    </ScreenBody>
    <StickyActionBar primaryAction={<Button variant="brand" onClick={onProceed}>Proceed</Button>} />
  </AppScreen>;
}
