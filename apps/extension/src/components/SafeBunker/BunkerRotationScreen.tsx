import { Alert, AlertIcon, Box, Button, Text, VStack } from "@chakra-ui/react";
import type { SafeBunkerAccount } from "@/chrome/types";
import type { BunkerAccountView } from "@/chrome/safeBunker/types";
import { AppHeader, AppScreen, ScreenBody, StickyActionBar } from "@/components/ui";
import AccountSettingsIdentity from "@/components/AccountSettingsIdentity";

export function BunkerRotationScreen({ account, view, busy, error, onBack, onRecover }: {
  account: SafeBunkerAccount; view: BunkerAccountView;
  busy: boolean; error: string;
  onBack: () => void; onRecover: () => void;
}) {
  const exposed = view.operations.some((op) => ["signed", "pending", "ambiguous"].includes(op.state));
  return <AppScreen>
    <AppHeader title="Rotate owner" onBack={onBack} isBackDisabled={busy} />
    <ScreenBody pt={5}><VStack align="stretch" spacing={5}>
      <Box pb={5} borderBottom="1px solid" borderColor="border.subtle"><AccountSettingsIdentity account={account} resolvedName={null} resolvedAvatar={null} /></Box>
        <Text fontSize="sm" color="fg.secondary">Switch to the next owner from your recovery phrase. You’ll review the transaction and choose a gas payer before signing.</Text>
        {view.recovering && <Box p={3} bg="surface.raised" borderRadius="lg"><Text fontSize="sm" fontWeight="600">Owner scan in progress</Text><Text fontSize="sm" color="fg.secondary" mt={1}>{view.recoveryProgress}</Text></Box>}
        {exposed && <Alert status="warning" alignItems="start"><AlertIcon /><Text fontSize="sm">An earlier signed transaction can still execute before recovery. Recovery does not cancel it.</Text></Alert>}
        {view.exposureUnknown && !view.recovering && <Alert status="warning" alignItems="start"><AlertIcon /><Text fontSize="sm">Complete an owner recovery before sending transactions.</Text></Alert>}
      {error && <Text role="alert" fontSize="sm" color="status.error.emphasis" overflowWrap="anywhere">{error}</Text>}
    </VStack></ScreenBody>
    <StickyActionBar secondaryAction={<Button variant="secondary" onClick={onBack} isDisabled={busy}>Cancel</Button>}
      primaryAction={<Button variant="brand" isLoading={busy} loadingText={view.recovering ? "Scanning…" : "Preparing…"} onClick={onRecover}>{view.recovering ? "Continue recovery scan" : "Review rotation"}</Button>} />
  </AppScreen>;
}
