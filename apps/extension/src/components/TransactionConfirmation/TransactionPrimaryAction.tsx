import type { ReactNode } from "react";
import type { PendingTxRequest } from "@/chrome/requests/pendingTxStorage";
import { shouldConfirmSimulationFailure } from "@/components/RequestConfirmation/simulationFailure";
import { ConfirmActionButton } from "./ConfirmationActions";
import type { TransactionAccountType } from "./types";
import type { useTransactionActions } from "./useTransactionActions";

interface TransactionPrimaryActionProps {
  actions: ReturnType<typeof useTransactionActions>;
  accountType?: TransactionAccountType;
  canSendImpersonatedTransaction: boolean;
  rejectButton: ReactNode;
  disabledReason: string | null;
  simulationReverted: boolean;
  reviewLoading: boolean;
  waitingForLedger: boolean;
  replacement: PendingTxRequest["replacement"];
}

export function TransactionPrimaryAction({
  actions,
  accountType,
  canSendImpersonatedTransaction,
  rejectButton,
  disabledReason,
  simulationReverted,
  reviewLoading,
  waitingForLedger,
  replacement,
}: TransactionPrimaryActionProps) {
  if (accountType === "impersonator" && !canSendImpersonatedTransaction) {
    return <>{rejectButton}</>;
  }
  return (
    <ConfirmActionButton
      state={actions.state}
      confirmDisabledReason={disabledReason}
      simulationFailed={shouldConfirmSimulationFailure({ simulationReverted })}
      waitingForLedger={waitingForLedger}
      isReviewLoading={reviewLoading}
      label={replacement?.kind === "cancel" ? "Submit cancellation" : replacement ? "Submit speed-up" : "Confirm"}
      onConfirm={actions.handleConfirm}
    />
  );
}
