import { VStack } from "@chakra-ui/react";
import { RequestRetryNotice } from "@/components/RequestConfirmation/RequestRetryNotice";
import { ViewOnlySigningNotice } from "@/components/shared/ViewOnlySigningNotice";
import { HardwareAccountSigningStatus } from "@/components/HardwareWallet/HardwareAccountSigningStatus";
import type { TransactionAccountType } from "./types";
import type { useTransactionActions } from "./useTransactionActions";

interface TransactionActionNoticeProps {
  actions: ReturnType<typeof useTransactionActions>;
  accountType?: TransactionAccountType;
  canSendImpersonatedTransaction: boolean;
  hardwareWaiting: boolean;
  hardwareVendor?: "keycardShell";
  simulationUnavailable: boolean;
}

export function TransactionActionNotice({
  actions,
  accountType,
  canSendImpersonatedTransaction,
  hardwareWaiting,
  hardwareVendor,
  simulationUnavailable,
}: TransactionActionNoticeProps) {
  const hasActionError = actions.state === "error" && !!actions.error;
  return (
    <VStack align="stretch" spacing={2}>
      {(hasActionError || simulationUnavailable) && (
        <RequestRetryNotice
          error={hasActionError ? actions.error : "Asset preview unavailable. Onchain transfers may still occur."}
          kind={hasActionError ? "error" : "warning"}
          onRetry={actions.retryUnavailable ? undefined : () => void actions.handleRetry()}
          isLoading={actions.isRetrying}
          isDisabled={actions.isRejecting || actions.isAddingToBatch}
        />
      )}
      {accountType === "impersonator" ? (
        <ViewOnlySigningNotice message={canSendImpersonatedTransaction
          ? "Developer RPC will send this transaction without a signature" : undefined} />
      ) : accountType === "ledger" || accountType === "trezor" ? (
        <HardwareAccountSigningStatus accountType={accountType} active={hardwareWaiting} vendor={hardwareVendor} />
      ) : null}
    </VStack>
  );
}
