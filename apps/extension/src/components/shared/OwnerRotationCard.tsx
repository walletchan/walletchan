import { ArrowForwardIcon } from "@chakra-ui/icons";
import { Box, Grid, HStack, Text } from "@chakra-ui/react";
import type { BunkerRotation } from "@/chrome/safeBunker/types";
import { LabeledAddressPopover } from "@/components/shared/LabeledAddressPopover";

export function OwnerRotationCard({ chainId, rotation, explorer }: { chainId: number; rotation: BunkerRotation; explorer?: string }) {
  return (
    <Grid role="group" aria-label="Owner rotation" templateColumns="minmax(0, 1fr) auto minmax(0, 1fr)"
      columnGap={2} rowGap={1.5} p={3} bg="surface.raised" border="1px solid" borderColor="border.default" borderRadius="lg">
      <HStack spacing={2} minW={0}>
        <Text fontSize="xs" color="fg.secondary">Old owner</Text>
        <Text fontSize="xs" color="fg.secondary" title="Seed derivation index">#{rotation.oldIndex}</Text>
      </HStack>
      <Box />
      <HStack spacing={2} minW={0}>
        <Text fontSize="xs" color="fg.secondary">New owner</Text>
        <Text fontSize="xs" color="fg.secondary" title="Seed derivation index">#{rotation.newIndex}</Text>
      </HStack>
      <Box minW={0} color="fg.primary" title={rotation.oldOwner} aria-label={`Old owner address ${rotation.oldOwner}`}>
        <LabeledAddressPopover chainId={chainId} address={rotation.oldOwner} addressOnly
          contextLabel="old owner" explorer={explorer} label={`${rotation.oldOwner.slice(0, 6)}...${rotation.oldOwner.slice(-4)}`} maxW="100%" />
      </Box>
      <ArrowForwardIcon alignSelf="center" color="fg.secondary" boxSize={4} aria-hidden />
      <Box minW={0} color="fg.primary" title={rotation.newOwner} aria-label={`New owner address ${rotation.newOwner}`}>
        <LabeledAddressPopover chainId={chainId} address={rotation.newOwner} addressOnly
          contextLabel="new owner" explorer={explorer} label={`${rotation.newOwner.slice(0, 6)}...${rotation.newOwner.slice(-4)}`} maxW="100%" />
      </Box>
    </Grid>
  );
}
