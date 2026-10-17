import { WarningTwoIcon } from "@chakra-ui/icons";
import { Box, HStack, Text } from "@chakra-ui/react";
import { useEnsRecipientHistory } from "./hooks/useEnsRecipientHistory";
import { formatEnsUpdateAge, recentEnsAddressUpdate } from "./model/ensRecipientHistory";

export function EnsRecipientHistoryNotice({ recipient, address, chainId }: {
  recipient: string; address: string | null; chainId: number;
}) {
  const state = useEnsRecipientHistory(recipient, address, chainId);
  if (!state) return null;
  if (state.status === "loading") return (
    <Text role="status" mt={2} fontSize="xs" color="fg.secondary">Checking ENS history…</Text>
  );
  if (state.status !== "ready") return null;
  const updatedAt = state.history ? recentEnsAddressUpdate(state.history) : null;
  if (updatedAt === null) return null;
  return (
    <Box role="alert" mt={2} p={3} bg="status.warning.tint"
      borderWidth="1px" borderColor="status.warning.border" borderRadius="lg">
      <HStack align="start" spacing={2}>
        <WarningTwoIcon boxSize="14px" flexShrink={0} color="status.warning.emphasis"
          mt="2px" aria-hidden="true" />
        <Box flex={1} minW={0}>
          <HStack justify="space-between" align="baseline" spacing={2} flexWrap="wrap" rowGap={0.5}>
            <Text fontSize="xs" fontWeight="600" lineHeight="short">ENS address updated</Text>
            <Text as="time" fontSize="xs" color="fg.secondary" lineHeight="short" whiteSpace="nowrap"
              dateTime={new Date(updatedAt).toISOString()} title={new Date(updatedAt).toLocaleString()}>
              {formatEnsUpdateAge(updatedAt)}
            </Text>
          </HStack>
          <Text mt={1} fontSize="xs" lineHeight="base" color="fg.secondary">
            Confirm the recipient’s address before sending.
          </Text>
        </Box>
      </HStack>
    </Box>
  );
}
