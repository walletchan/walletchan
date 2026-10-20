import { Box, HStack, Text, Tooltip, Wrap, WrapItem } from "@chakra-ui/react";
import ChainIcon from "@/components/ChainIcon";
import type { BunkerNetwork, DiscoveryRow } from "./useBunkerDiscovery";
import { deployedBunker } from "./discoveryModel";
/** Informational, never a button or navigation target. */
export function BunkerChainPills({ networks, results, iconsOnly = false }: { networks: BunkerNetwork[]; results: Record<number, DiscoveryRow>; iconsOnly?: boolean }) {
  const deployed = networks.filter(n => deployedBunker(results[n.chainId]));
  if (!deployed.length) return null;
  if (iconsOnly) return <HStack as="span" spacing={2} flexWrap="wrap" rowGap={2}>{deployed.map(n => {
    const label = `${n.name}${results[n.chainId]?.status === "pending" ? " · Deploying" : ""}`;
    return <Tooltip key={n.chainId} label={label} hasArrow>
      <Box as="span" display="inline-flex" aria-label={label} borderRadius="full"><ChainIcon chainId={n.chainId} chainName={n.name} size="20px" /></Box>
    </Tooltip>;
  })}</HStack>;
  return <Wrap spacing={2}>{deployed.map(n => <WrapItem key={n.chainId}>
    <HStack px={2} py={1} spacing={1.5} bg="surface.raised" borderRadius="full" border="1px solid" borderColor="border.subtle">
      <ChainIcon chainId={n.chainId} chainName={n.name} size="16px" />
      <Text fontSize="xs" color="fg.secondary">{n.name}{results[n.chainId]?.status === "pending" ? " · Deploying" : ""}</Text>
    </HStack>
  </WrapItem>)}</Wrap>;
}
