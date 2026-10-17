import { HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import type { ConfirmationState } from "./types";
import type { SplitPriorTxState } from "./useSplitPriorTxState";

interface RequestStatusProps {
  gasValid: boolean;
  splitState: SplitPriorTxState;
  state: ConfirmationState;
  isLaterSplitTransaction: boolean;
}

export function RequestStatus({
  gasValid,
  splitState,
  state,
  isLaterSplitTransaction,
}: RequestStatusProps) {
  return (
    <VStack spacing={2} align="stretch">
      {state === "submitting" && (
        <HStack
          justify="center"
          py={3}
          bg="accent.secondary"
          border="1px solid"
          borderColor="border.default"
          borderRadius="lg"
        >
          <Spinner size="sm" color="accentFg.secondary" />
          <Text fontSize="sm" color="accentFg.secondary" fontWeight="700">
            Submitting transaction…
          </Text>
        </HStack>
      )}

      {(!splitState.ready || (isLaterSplitTransaction && !gasValid)) &&
        state !== "submitting" && (
          <HStack
            justify="center"
            py={3}
            bg="bg.muted"
            border="1px solid"
            borderColor="border.default"
            borderRadius="lg"
          >
            {!splitState.ready && <Spinner size="sm" color="text.secondary" />}
            <Text fontSize="sm" color="text.secondary" fontWeight="700">
              {!splitState.ready
                ? splitState.label
                : "Estimating gas with new chain state…"}
            </Text>
          </HStack>
        )}
    </VStack>
  );
}
