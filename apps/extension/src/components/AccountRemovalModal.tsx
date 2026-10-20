import { useEffect, useRef, useState } from "react";
import { Box, VStack, HStack, Text, Button, Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalFooter, Spinner } from "@chakra-ui/react";
import { WarningTwoIcon } from "@chakra-ui/icons";
import type { Account } from "@/chrome/types";
import { fetchPortfolioSummary } from "@/chrome/portfolio/api";
import { formatUsd } from "@/lib/currencyFormatUtils";
import MiddleTruncatedAddress from "./MiddleTruncatedAddress";
import { getAccountRemovalCopy, type AccountRemovalStep } from "./accountRemovalModel";

/** Shared account/phrase deletion review; callers retain their guarded worker transport. */
export function AccountRemovalModal({ account, accounts, resolvedName, isOpen, isDeleting, deleteStep, onStepChange, onClose, onConfirm, error, disabledReason }: {
  account: Account; accounts: Account[]; resolvedName?: string | null; isOpen: boolean; isDeleting: boolean;
  deleteStep: AccountRemovalStep; onStepChange: (step: AccountRemovalStep) => void; onClose: () => void;
  onConfirm: () => void; error?: string; disabledReason?: string;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const deleteCopy = getAccountRemovalCopy(account, accounts, deleteStep);
  const deleteAccountName = account.displayName?.trim() || resolvedName;
  const [deletePortfolio, setDeletePortfolio] = useState<{
    status: "idle" | "loading" | "ready" | "error";
    totalValueUsd: number | null;
  }>({ status: "idle", totalValueUsd: null });

  useEffect(() => {
    if (!isOpen) {
      setDeletePortfolio({ status: "idle", totalValueUsd: null });
      return;
    }

    const controller = new AbortController();
    setDeletePortfolio({ status: "loading", totalValueUsd: null });

    void fetchPortfolioSummary(account.address, controller.signal)
      .then((portfolio) => {
        if (controller.signal.aborted) return;
        setDeletePortfolio({
          status: "ready",
          totalValueUsd: portfolio.totalValueUsd,
        });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setDeletePortfolio({ status: "error", totalValueUsd: null });
      });

    return () => controller.abort();
  }, [account.address, isOpen]);

  return (
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        initialFocusRef={cancelRef}
        closeOnEsc={!isDeleting}
        closeOnOverlayClick={!isDeleting}
        isCentered
      >
        <ModalOverlay bg="surface.overlay" />
        <ModalContent mx={4}>
          <ModalHeader
            color="fg.primary"
            fontSize="lg"
            pb={2}
          >
            <Box display="flex" alignItems="center" gap={2}>
              <Box
                w="32px"
                h="32px"
                display="grid"
                placeItems="center"
                bg="status.error.bg"
                borderRadius="md"
              >
                <WarningTwoIcon color="status.error.fg" />
              </Box>
              {deleteCopy.title}
            </Box>
          </ModalHeader>

          <ModalBody>
            {deleteStep === "review" ? (
              <VStack spacing={3} align="stretch">
                <Text color="text.secondary" fontSize="sm" fontWeight="500">
                  {deleteCopy.description}
                </Text>

                <Box
                  p={3}
                  bg="surface.sunken"
                  border="1px solid"
                  borderColor="border.default"
                  borderRadius="md"
                >
                  {deleteAccountName && (
                    <Text fontSize="sm" fontWeight="700" color="fg.primary" mb={1}>
                      {deleteAccountName}
                    </Text>
                  )}
                  <Box color="fg.secondary">
                    <MiddleTruncatedAddress address={account.address} />
                  </Box>

                  <HStack
                    mt={3}
                    pt={3}
                    borderTop="1px solid"
                    borderColor="border.subtle"
                    justify="space-between"
                    align="center"
                  >
                    <Text fontSize="sm" color="fg.secondary" fontWeight="600">
                      Current portfolio
                    </Text>
                    <Box minW="104px" textAlign="right" aria-live="polite">
                      {deletePortfolio.status === "loading" ? (
                        <Spinner
                          size="sm"
                          color="fg.secondary"
                          aria-label="Loading portfolio balance"
                        />
                      ) : deletePortfolio.status === "ready" ? (
                        <Text
                          fontSize="lg"
                          lineHeight="short"
                          color="fg.primary"
                          fontWeight="700"
                          sx={{ fontVariantNumeric: "tabular-nums" }}
                        >
                          {formatUsd(deletePortfolio.totalValueUsd ?? 0)}
                        </Text>
                      ) : (
                        <Text fontSize="sm" color="fg.muted" fontWeight="600">
                          Unavailable
                        </Text>
                      )}
                    </Box>
                  </HStack>
                </Box>

                {deleteCopy.warningTitle && (
                  <Box
                    w="full"
                    p={3}
                    bg="status.error.bg"
                    border="1px solid"
                    borderColor="status.error.border"
                    borderRadius="md"
                  >
                    <Text color="status.error.fg" fontSize="sm" fontWeight="700">
                      {deleteCopy.warningTitle}
                    </Text>
                    {deleteCopy.warningDescription && (
                      <Text color="status.error.fg" fontSize="sm" fontWeight="500" mt={1}>
                        {deleteCopy.warningDescription}
                      </Text>
                    )}
                  </Box>
                )}
              </VStack>
            ) : (
              <VStack spacing={4} align="stretch">
                <Text color="fg.secondary" fontSize="sm" fontWeight="500">
                  {deleteCopy.description}
                </Text>
                <Box
                  p={3}
                  bg="status.error.bg"
                  border="1px solid"
                  borderColor="status.error.border"
                  borderRadius="md"
                >
                  {deleteAccountName && (
                    <Text color="status.error.fg" fontSize="sm" fontWeight="700" mb={1}>
                      {deleteAccountName}
                    </Text>
                  )}
                  <Box color="status.error.fg">
                    <MiddleTruncatedAddress address={account.address} />
                  </Box>
                </Box>
                <Text color="fg.primary" fontSize="sm" fontWeight="700">
                  {deleteCopy.caution}
                </Text>
              </VStack>
            )}
            {error && <Text role="alert" fontSize="sm" color="status.error.emphasis" mt={3}>{error}</Text>}
            {disabledReason && <Text role="status" fontSize="sm" color="fg.secondary" mt={3}>{disabledReason}</Text>}
          </ModalBody>

          <ModalFooter gap={2}>
            <Button
              ref={cancelRef}
              variant="secondary"
              size="sm"
              onClick={onClose}
              isDisabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={
                deleteStep === "review"
                  ? () => onStepChange("final")
                  : onConfirm
              }
              isDisabled={!!disabledReason}
              isLoading={isDeleting}
              loadingText={deleteCopy.loadingLabel}
            >
              {deleteCopy.actionLabel}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
  );
}
