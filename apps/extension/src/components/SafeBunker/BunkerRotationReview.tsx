import { Box, HStack, Skeleton, Text, VStack } from "@chakra-ui/react";
import type { BunkerRotation } from "@/chrome/safeBunker/types";
import { OwnerRotationCard } from "@/components/shared/OwnerRotationCard";
import { LabeledAddressPopover } from "@/components/shared/LabeledAddressPopover";
import { ListItem, ListSurface } from "@/components/ui";

interface Props {
  chainId: number;
  rotation?: BunkerRotation;
  explorer?: string;
  loading?: boolean;
}
export function BunkerRotationPreview({ chainId, rotation, explorer, loading }: Props) {
  if (rotation) return <OwnerRotationCard chainId={chainId} rotation={rotation} explorer={explorer} />;
  return <Box p={3} bg="surface.raised" border="1px solid" borderColor="border.default" borderRadius="lg">
    {loading ? <HStack justify="space-between" minH="48px" aria-label="Loading owner rotation"><Skeleton h="32px" w="40%" /><Skeleton h="32px" w="40%" /></HStack>
      : <Text fontSize="sm" color="fg.secondary">Choose a gas payer to preview the owner rotation.</Text>}
  </Box>;
}
export function BunkerRotationCalls({ chainId, rotation, explorer }: Props) {
  return <ListSurface aria-label="Owner rotation actions">
    {([['Remove owner', rotation?.oldOwner, rotation?.oldIndex], ['Set owner', rotation?.newOwner, rotation?.newIndex]] as const).map(([label, address, index]) => (
      <ListItem key={label} density="compact" justify="space-between" gap={2}>
        <VStack align="start" spacing={0} minW={0}>
          <Text fontSize="sm" fontWeight="600">{label}</Text>
          {index !== undefined && <Text fontSize="xs" color="fg.secondary">#{index}</Text>}
        </VStack>
        {address ? <Box minW={0} maxW="60%"><LabeledAddressPopover chainId={chainId} address={address} addressOnly contextLabel={label === 'Remove owner' ? 'removed owner' : 'new owner'} explorer={explorer}
          label={`${address.slice(0, 6)}...${address.slice(-4)}`} maxW="100%" /></Box> : <Skeleton w="116px" h="28px" />}
      </ListItem>
    ))}
  </ListSurface>;
}
