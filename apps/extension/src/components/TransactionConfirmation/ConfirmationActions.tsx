import { Button, Spinner } from "@chakra-ui/react";
import { ShapesLoader } from "@/components/Chat/ShapesLoader";
import { SimulationFailureConfirmButton } from "@/components/RequestConfirmation/SimulationFailureConfirmButton";
import type { ConfirmationState } from "./types";

interface ActionButtonProps {
  state: ConfirmationState;
  isRejecting: boolean;
  isDisabled?: boolean;
  onReject: () => void;
}

export function RejectActionButton({
  state,
  isRejecting,
  isDisabled = false,
  onReject,
}: ActionButtonProps) {
  return (
    <Button
      variant="secondary"
      w="full"
      onClick={onReject}
      isLoading={isRejecting}
      isDisabled={state === "submitting" || isDisabled}
      spinner={<Spinner size="sm" sx={{ animationDirection: "reverse" }} />}
    >
      Reject
    </Button>
  );
}

interface ConfirmActionButtonProps {
  state: ConfirmationState;
  confirmDisabledReason: string | null;
  simulationFailed: boolean;
  waitingForLedger?: boolean;
  isReviewLoading?: boolean;
  label?: string;
  onConfirm: () => void;
}

export function ConfirmActionButton({
  state,
  confirmDisabledReason,
  simulationFailed,
  waitingForLedger = false,
  isReviewLoading = false,
  label = "Confirm",
  onConfirm,
}: ConfirmActionButtonProps) {
  return (
    <SimulationFailureConfirmButton
      disabledReason={confirmDisabledReason}
      isDisabled={!!confirmDisabledReason}
      isLoading={state === "submitting" || isReviewLoading}
      label={label}
      loadingSpinner={
        waitingForLedger ? (
          <ShapesLoader
            variant="dots"
            size="6px"
            color="accentFg.highlight"
          />
        ) : undefined
      }
      loadingText={waitingForLedger ? "Waiting" : isReviewLoading ? "Preparing…" : undefined}
      onConfirm={onConfirm}
      requestKind="transaction"
      simulationFailed={simulationFailed}
    />
  );
}
