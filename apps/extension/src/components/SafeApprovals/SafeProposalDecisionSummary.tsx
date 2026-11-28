import {
  Badge,
  HStack,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { PendingTxRequest } from "@/chrome/requests/pendingTxStorage";
import type { GasOverrides } from "@/chrome/txHandlers";
import { DecisionAccountSelector } from "@/components/RequestConfirmation/DecisionAccountSelector";
import GasEstimateDisplay from "@/components/GasEstimateDisplay";
import {
  FeePaymentSelector,
  type FeePaymentQuoteSummary,
} from "@/components/FeePaymentSelector";
import type { NativeFeePaymentSummary } from "@/components/feePaymentUi";
import { useEffect, useState } from "react";
import type {
  SafeExecutorAccount,
  SafeOwnerAccount,
  SafeProposalActionKind,
} from "./safeProposalActionModel";

type DecisionAccount = SafeOwnerAccount | SafeExecutorAccount;

export function SafeProposalDecisionSummary({
  chainId,
  actionKind,
  accounts,
  selectedAccount,
  safeOwnerAccountIds,
  executionRequest,
  proposalId,
  onSelect,
  onGasOverrides,
  onGasValidityChange,
  onGasLoadingChange,
  feePaymentToken,
  feePaymentQuote,
  onFeePaymentTokenChange,
  onFeePaymentQuoteChange,
  disabled = false,
  signAndExecute = false,
}: {
  actionKind: SafeProposalActionKind;
  accounts: readonly DecisionAccount[];
  selectedAccount: DecisionAccount | null;
  safeOwnerAccountIds: ReadonlySet<string>;
  executionRequest: PendingTxRequest | null;
  proposalId: string;
  chainId: number;
  onSelect: (accountId: string) => void;
  onGasOverrides: (overrides: GasOverrides | null) => void;
  onGasValidityChange: (valid: boolean) => void;
  onGasLoadingChange?: (loading: boolean) => void;
  feePaymentToken: "native" | `0x${string}`;
  feePaymentQuote: FeePaymentQuoteSummary | null;
  onFeePaymentTokenChange: (token: "native" | `0x${string}`) => void;
  onFeePaymentQuoteChange: (quote: FeePaymentQuoteSummary | null) => void;
  disabled?: boolean;
  signAndExecute?: boolean;
}) {
  const [feeOptionsLoading, setFeeOptionsLoading] = useState(true);
  const [nativeFeeSummary, setNativeFeeSummary] =
    useState<NativeFeePaymentSummary | null>(null);
  useEffect(() => {
    setNativeFeeSummary(null);
  }, [executionRequest?.id]);
  if (!actionKind || !selectedAccount) return null;

  const identity = <DecisionAccountSelector accounts={accounts} selectedAccount={selectedAccount} chainId={chainId}
    onSelect={onSelect} disabled={disabled} label={actionKind === "execute" ? "Choose execution account" : "Choose signing account"}
    renderBadge={(account) => actionKind === "execute" && safeOwnerAccountIds.has(account.id)
      ? <Badge variant="subtle" fontSize="2xs" flexShrink={0}>Owner</Badge> : null} />;

  return (
    <VStack align="stretch" spacing={2}>
      <HStack minW={0} justify="space-between" spacing={3}>
        <Text color="fg.secondary" fontSize="xs" fontWeight="600" flexShrink={0}>
          {signAndExecute ? "Sign & execute with" : actionKind === "execute" ? "Execute with" : "Signing with"}
        </Text>
        <HStack minW={0} justify="flex-end">
          {identity}
        </HStack>
      </HStack>

      {actionKind === "execute" && executionRequest && (
        <>
          {!signAndExecute && <FeePaymentSelector
            txId={proposalId}
            chainId={executionRequest.tx.chainId}
            requestKind="safe"
            accountId={selectedAccount.id}
            value={feePaymentToken}
            quote={feePaymentQuote}
            nativeSummary={nativeFeeSummary}
            onOptionsLoadingChange={setFeeOptionsLoading}
            onChange={onFeePaymentTokenChange}
            onQuoteChange={onFeePaymentQuoteChange}
            disabled={disabled}
          />}
          {feePaymentToken === "native" && (
            <GasEstimateDisplay
              txRequest={executionRequest}
              accountType={selectedAccount.type as SafeExecutorAccount["type"]}
              onGasOverrides={onGasOverrides}
              onValidityChange={onGasValidityChange}
              onLoadingChange={onGasLoadingChange}
              onFeeSummaryChange={setNativeFeeSummary}
              hideInsufficientBalanceWarning={!signAndExecute && feeOptionsLoading && !disabled}
              isReadOnly={disabled}
            />
          )}
        </>
      )}
    </VStack>
  );
}
