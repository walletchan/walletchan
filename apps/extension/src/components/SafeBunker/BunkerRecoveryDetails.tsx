import { CopyIcon, ExternalLinkIcon } from "@chakra-ui/icons";
import { Box, Button, HStack, IconButton, Text, VStack } from "@chakra-ui/react";
import type { BunkerAccountView } from "@/chrome/safeBunker/types";
import { AppHeader, AppScreen, InlineDisclosure, ListItem, ListSurface, ScreenBody, StickyActionBar } from "@/components/ui";
import ChainIcon from "@/components/ChainIcon";
import { CopyButton } from "@/components/CopyButton";
import { LabeledAddressPopover } from "@/components/shared/LabeledAddressPopover";
import { useThemedToast } from "@/hooks/useThemedToast";

export function BunkerRecoveryDetails({ view, explorer, onBack }: {
  view: BunkerAccountView;
  explorer?: string;
  onBack: () => void;
}) {
  const toast = useThemedToast();
  async function copy() {
    try {
      await navigator.clipboard.writeText(JSON.stringify({
        format: "walletchan-bunker-v1",
        chainId: view.chainId,
        safeAddress: view.safeAddress,
        deploymentHash: view.deploymentHash,
        derivationVersion: 1,
      }, null, 2));
      toast({ title: "Recovery details copied", status: "success", duration: 2000 });
    } catch {
      toast({ title: "Could not copy recovery details", status: "error", duration: 3000 });
    }
  }
  return (
    <AppScreen>
      <AppHeader title="Recovery details" onBack={onBack} />
      <ScreenBody pt={5}>
        <VStack align="stretch" spacing={5}>
          <Text fontSize="sm" color="fg.secondary">
            Keep these details with your recovery phrase.
          </Text>
          <ListSurface aria-label="Public recovery details">
            <ListItem density="compact" justify="space-between" gap={2}>
              <Text fontSize="sm" color="fg.secondary" flexShrink={0}>Safe address</Text>
              <Box minW={0} maxW="60%">
                <LabeledAddressPopover
                  chainId={view.chainId}
                  address={view.safeAddress}
                  addressOnly
                  contextLabel="Safe address"
                  explorer={explorer}
                  label={`${view.safeAddress.slice(0, 6)}...${view.safeAddress.slice(-4)}`}
                  maxW="100%"
                />
              </Box>
            </ListItem>
            <ListItem density="compact" justify="space-between">
              <Text fontSize="sm" color="fg.secondary">Network</Text>
              <HStack spacing={2} minW={0}>
                <ChainIcon chainId={view.chainId} size="20px" />
                <Text fontSize="sm" fontWeight="600">Sepolia</Text>
              </HStack>
            </ListItem>
            <ListItem density="compact" justify="space-between" gap={2}>
              <Text fontSize="sm" color="fg.secondary" flexShrink={0}>Deployment</Text>
              {view.deploymentHash ? (
                <HStack spacing={1} minW={0}>
                  <Text fontFamily="mono" fontSize="xs" title={view.deploymentHash} noOfLines={1} minW={0}>
                    {view.deploymentHash.slice(0, 8)}…{view.deploymentHash.slice(-6)}
                  </Text>
                  <CopyButton value={view.deploymentHash} label="Copy deployment transaction" />
                  {explorer && (
                    <IconButton
                      as="a"
                      href={`${explorer}/tx/${view.deploymentHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="View deployment transaction on explorer"
                      icon={<ExternalLinkIcon />}
                      variant="ghost"
                      size="xs"
                      minW="24px"
                      w="24px"
                      h="24px"
                      color="fg.secondary"
                    />
                  )}
                </HStack>
              ) : <Text fontSize="sm" color="fg.muted">Unavailable</Text>}
            </ListItem>
          </ListSurface>
          {!view.deploymentHash && (
            <Text role="status" fontSize="sm" color="fg.secondary">
              Refresh Bunker details to retrieve the deployment transaction.
            </Text>
          )}
          <InlineDisclosure label="Advanced details">
            <VStack align="stretch" spacing={3} px={2} pb={3}>
              <HStack justify="space-between" spacing={3}>
                <Text fontSize="sm" color="fg.secondary">Chain ID</Text>
                <Text fontSize="sm" fontFamily="mono">{view.chainId}</Text>
              </HStack>
              <HStack justify="space-between" spacing={3}>
                <Text fontSize="sm" color="fg.secondary">Derivation version</Text>
                <Text fontSize="sm" fontFamily="mono">1</Text>
              </HStack>
              <Box>
                <Text fontSize="sm" color="fg.secondary" mb={1}>Owner derivation path</Text>
                <Text fontSize="sm" fontFamily="mono" overflowWrap="anywhere">m/44&apos;/60&apos;/0&apos;/0&apos;/n&apos;</Text>
              </Box>
            </VStack>
          </InlineDisclosure>
        </VStack>
      </ScreenBody>
      <StickyActionBar primaryAction={
        <Button variant="brand" leftIcon={<CopyIcon />} onClick={() => void copy()} isDisabled={!view.deploymentHash}>
          Copy recovery details
        </Button>
      } />
    </AppScreen>
  );
}
