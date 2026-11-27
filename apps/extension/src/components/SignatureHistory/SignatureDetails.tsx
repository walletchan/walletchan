import {
  Box,
  HStack,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalHeader,
  ModalOverlay,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { SignatureHistoryEntry } from "@/chrome/signatureHistory/types";
import { CopyButton } from "@/components/CopyButton";
import { RequestChainContext } from "@/components/RequestConfirmation/EstimatedChangesHeading";
import { InlineDisclosure } from "@/components/ui";
import { getResolvedChainById } from "@/lib/chains";
import { useNetworks } from "@/contexts/NetworksContext";
import {
  signatureOrigin,
  signaturePayload,
  signatureTitle,
} from "./presentation";

export function SignatureDetails({
  entry,
  onClose,
}: {
  entry: SignatureHistoryEntry;
  onClose: () => void;
}) {
  const { networksInfo } = useNetworks();
  const chainName =
    getResolvedChainById(entry.chainId, networksInfo)?.name ??
    `Chain ${entry.chainId}`;
  const signedAt = new Date(entry.createdAt);


  return (
    <Modal
      isOpen
      onClose={onClose}
      isCentered
      scrollBehavior="inside"
      size="lg"
    >
      <ModalOverlay bg="surface.overlay" />
      <ModalContent mx={3} maxH="90dvh">
        <ModalHeader fontSize="md" pr={12} pb={3}>
          {signatureTitle(entry)}
        </ModalHeader>
        <ModalCloseButton />
        <ModalBody px={5} pb={4}>
          <VStack align="stretch" spacing={4}>
            <Box>
              <Text
                fontSize="xl"
                fontWeight="600"
                lineHeight="short"
                overflowWrap="anywhere"
              >
                {signatureOrigin(entry.origin)}
              </Text>
              <Text
                as="time"
                dateTime={signedAt.toISOString()}
                fontSize="xs"
                color="fg.secondary"
                mt={1}
              >
                {signedAt.toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
                {" · "}
                {signedAt.toLocaleTimeString(undefined, {
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </Text>
            </Box>

            <VStack
              align="stretch"
              spacing={2}
              borderTopWidth="1px"
              borderColor="border.subtle"
              pt={3}
            >
              <HStack spacing={3} align="start">
                <Text
                  fontSize="xs"
                  color="fg.secondary"
                  w="58px"
                  pt={1}
                  flexShrink={0}
                >
                  Network
                </Text>
                <Box minW={0} overflowWrap="anywhere">
                  <RequestChainContext
                    chainId={entry.chainId}
                    chainName={chainName}
                    showPreposition={false}
                  />
                </Box>
              </HStack>
            </VStack>

            <Box minW={0}>
              <HStack justify="space-between" mb={2}>
                <Text fontSize="sm" fontWeight="600">
                  Signed content
                </Text>
                <CopyButton
                  value={
                    typeof entry.payload === "string"
                      ? entry.payload
                      : JSON.stringify(entry.payload, null, 2)
                  }
                  label="Copy exact signed content"
                />
              </HStack>
              <Box
                as="pre"
                fontFamily="mono"
                fontSize="xs"
                lineHeight="tall"
                whiteSpace="pre-wrap"
                overflowWrap="anywhere"
                bg="surface.sunken"
                borderWidth="1px"
                borderColor="border.subtle"
                borderRadius="md"
                p={3}
                m={0}
                maxH="35dvh"
                overflowY="auto"
                tabIndex={0}
                aria-label="Signed content"
                _focusVisible={{ boxShadow: "focus", outline: "none" }}
              >
                {signaturePayload(entry)}
              </Box>
            </Box>

            <InlineDisclosure label="Technical details">
              <VStack align="stretch" spacing={0}>
                {[
                  ...(entry.source === "injected"
                    ? []
                    : [["Source", entry.source === "walletconnect" ? "WalletConnect" : "WalletChan"]]),
                  ["Method", entry.method],
                  ["Origin", entry.origin],
                  ["Chain ID", String(entry.chainId)],
                  ["Signing digest", entry.digest],
                  ...(entry.safeAddress ? [["Safe", entry.safeAddress]] : []),
                ].map(([label, value]) => (
                  <HStack
                    key={label}
                    align="start"
                    spacing={3}
                    py={2}
                    borderBottomWidth="1px"
                    borderColor="border.subtle"
                    _last={{ borderBottomWidth: 0 }}
                  >
                    <Text
                      fontSize="xs"
                      color="fg.secondary"
                      w="80px"
                      flexShrink={0}
                    >
                      {label}
                    </Text>
                    <Text
                      fontSize="xs"
                      fontFamily={
                        label === "Source"
                          ? "body"
                          : "mono"
                      }
                      overflowWrap="anywhere"
                      flex={1}
                      minW={0}
                    >
                      {value}
                    </Text>
                    {label === "Signing digest" && (
                      <CopyButton value={value} label="Copy signing digest" />
                    )}
                  </HStack>
                ))}
              </VStack>
            </InlineDisclosure>
          </VStack>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
