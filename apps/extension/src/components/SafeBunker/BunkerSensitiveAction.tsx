import { useRef, useState } from "react";
import { Alert, AlertIcon, Box, Button, Checkbox, Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalFooter, Text, VStack } from "@chakra-ui/react";
import { WarningTwoIcon } from "@chakra-ui/icons";
import MiddleTruncatedAddress from "@/components/MiddleTruncatedAddress";
import type { SafeBunkerAccount } from "@/chrome/types";
import type { BunkerAccountView } from "@/chrome/safeBunker/types";
import { AppHeader, AppScreen, ScreenBody, StickyActionBar } from "@/components/ui";
import AccountSettingsIdentity from "@/components/AccountSettingsIdentity";

export function BunkerSensitiveAction({ kind, account, view, busy, error, removeBlocked, onBack, onRemove, onRecover }: {
  kind: "remove" | "recover"; account: SafeBunkerAccount; view: BunkerAccountView;
  busy: boolean; error: string; removeBlocked?: string;
  onBack: () => void; onRemove: () => Promise<void>; onRecover: () => void;
}) {
  const [backedUp, setBackedUp] = useState(false);
  const [confirmRemoval, setConfirmRemoval] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const closeConfirmation = () => { if (!busy) setConfirmRemoval(false); };
  const removing = kind === "remove";
  const exposed = view.operations.some((op) => ["signed", "pending", "ambiguous"].includes(op.state));
  return <AppScreen>
    <AppHeader title={removing ? "Remove account" : "Rotate owner"} onBack={onBack} isBackDisabled={busy} />
    <ScreenBody pt={5}><VStack align="stretch" spacing={5}>
      <Box pb={5} borderBottom="1px solid" borderColor="border.subtle"><AccountSettingsIdentity account={account} resolvedName={null} resolvedAvatar={null} /></Box>
      {removing ? <>
        <Alert status="warning" alignItems="start"><AlertIcon /><Text fontSize="sm">You need the recovery phrase and public recovery details to restore access. Encrypted recovery archives remain on this device.</Text></Alert>
        {removeBlocked && <Text role="status" fontSize="sm" color="fg.secondary">{removeBlocked}</Text>}
        <Checkbox variant="commitment" isChecked={backedUp} isDisabled={busy || !!removeBlocked} onChange={(e) => setBackedUp(e.target.checked)}>
          <Text fontSize="sm">I saved my recovery phrase and recovery details</Text>
        </Checkbox>
      </> : <>
        <Text fontSize="sm" color="fg.secondary">Switch to the next owner from your recovery phrase. You’ll review the transaction and choose a gas payer before signing.</Text>
        {view.recovering && <Box p={3} bg="surface.raised" borderRadius="lg"><Text fontSize="sm" fontWeight="600">Owner scan in progress</Text><Text fontSize="sm" color="fg.secondary" mt={1}>{view.recoveryProgress}</Text></Box>}
        {exposed && <Alert status="warning" alignItems="start"><AlertIcon /><Text fontSize="sm">An earlier signed transaction can still execute before recovery. Recovery does not cancel it.</Text></Alert>}
        {view.exposureUnknown && !view.recovering && <Alert status="warning" alignItems="start"><AlertIcon /><Text fontSize="sm">Complete an owner recovery before sending transactions.</Text></Alert>}
      </>}
      {error && !confirmRemoval && <Text role="alert" fontSize="sm" color="status.error.emphasis" overflowWrap="anywhere">{error}</Text>}
    </VStack></ScreenBody>
    <StickyActionBar secondaryAction={<Button variant="secondary" onClick={onBack} isDisabled={busy}>Cancel</Button>}
      primaryAction={removing ? <Button variant="danger" isLoading={busy} loadingText="Removing…" isDisabled={!backedUp || !!removeBlocked}
        onClick={() => setConfirmRemoval(true)}>Remove account</Button>
        : <Button variant="brand" isLoading={busy} loadingText={view.recovering ? "Scanning…" : "Preparing…"} onClick={onRecover}>{view.recovering ? "Continue recovery scan" : "Review rotation"}</Button>} />
    <Modal isOpen={confirmRemoval} onClose={closeConfirmation} isCentered initialFocusRef={cancelRef} closeOnEsc={!busy} closeOnOverlayClick={!busy}>
      <ModalOverlay bg="surface.overlay" />
      <ModalContent mx={4}>
        <ModalHeader color="fg.primary" fontSize="lg" pb={2}>
          <Box display="flex" alignItems="center" gap={2}>
            <Box w="32px" h="32px" display="grid" placeItems="center" bg="status.error.bg" borderRadius="md"><WarningTwoIcon color="status.error.fg" /></Box>
            Remove account?
          </Box>
        </ModalHeader>
        <ModalBody><VStack spacing={4} align="stretch">
          <Text color="fg.secondary" fontSize="sm">You’ll need your recovery phrase and recovery details to add this account again.</Text>
          <Box p={3} bg="surface.sunken" border="1px solid" borderColor="border.default" borderRadius="md">
            {account.displayName && <Text color="fg.primary" fontSize="sm" fontWeight="700" mb={1}>{account.displayName}</Text>}
            <Box color="fg.primary"><MiddleTruncatedAddress address={account.address} /></Box>
          </Box>
          {error && <Text role="alert" color="status.error.emphasis" fontSize="sm" overflowWrap="anywhere">{error}</Text>}
          {removeBlocked && <Text role="status" color="fg.secondary" fontSize="sm">{removeBlocked}</Text>}
        </VStack></ModalBody>
        <ModalFooter gap={2}>
          <Button ref={cancelRef} variant="secondary" size="sm" onClick={closeConfirmation} isDisabled={busy}>Cancel</Button>
          <Button variant="dangerSolid" size="sm" onClick={() => { void onRemove(); }} isLoading={busy} loadingText="Removing…" isDisabled={!backedUp || !!removeBlocked}>Remove account</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  </AppScreen>;
}
