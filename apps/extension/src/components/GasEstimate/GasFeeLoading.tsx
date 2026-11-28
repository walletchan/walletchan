import { Box, HStack, Text } from "@chakra-ui/react";
import { ShapesLoader } from "@/components/Chat/ShapesLoader";

/** Shared loading state in the fee row for transaction confirmations. */
export function GasFeeLoading() {
  return <Box role="status" aria-label="Estimating gas" border="1px solid" borderColor="border.default"
    borderRadius="lg" bg="surface.raised" boxShadow="none" minH="44px">
    <HStack px={3} py={3} justify="center" spacing={3}>
      <ShapesLoader size="6px" />
      <Text fontSize="xs" color="text.secondary" fontWeight="600">Estimating gas…</Text>
    </HStack>
  </Box>;
}
