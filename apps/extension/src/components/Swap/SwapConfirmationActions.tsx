import { Button, HStack, Spinner, Text } from "@chakra-ui/react";
import type { Dispatch, SetStateAction } from "react";
import { StickyActionBar } from "@/components/ui";
import type { FeePaymentQuoteSummary } from "@/components/FeePaymentSelector";
import { SwapPriceImpactNotice } from "./SwapPriceImpactNotice";
import { SwapDecisionSummary } from "./SwapDecisionSummary";
import type { SwapConfirmationProps } from "./swapViewTypes";

type Props = Pick<SwapConfirmationProps,
  "requestId" | "isSubmitting" | "onRefreshQuote" | "fromAddress" | "accountId" |
  "chainId" | "isBatched" | "eip7702Delegate" | "onGasEstimates" |
  "onValidityChange" | "impactReview" | "onConfirm" | "isConfirmDisabled" | "onCancel"
> & {
  accountType: Exclude<SwapConfirmationProps["accountType"], "safeBunker">;
  isNativeGasValid: boolean; isBridge: boolean; titleLabel: string;
  gasTransactions: Array<{ tx: { from: string; to: string; data: string; value: string; chainId: number }; label: string }>;
  gasBatchedTx?: { tx: { from: string; to: string; data: string; value: string; chainId: number }; label: string };
  feePaymentToken: "native" | `0x${string}`; feePaymentQuote: FeePaymentQuoteSummary | null;
  setFeePaymentToken: Dispatch<SetStateAction<"native" | `0x${string}`>>;
  setFeePaymentQuote: Dispatch<SetStateAction<FeePaymentQuoteSummary | null>>;
};
export function SwapConfirmationActions({
  requestId, isSubmitting, onRefreshQuote, gasTransactions, fromAddress,
  accountId, accountType, chainId, isBatched, gasBatchedTx,
  eip7702Delegate, feePaymentToken, feePaymentQuote, setFeePaymentToken, setFeePaymentQuote,
  onGasEstimates, onValidityChange, impactReview, isBridge, onConfirm,
  isConfirmDisabled, isNativeGasValid, onCancel, titleLabel,
}: Props) {
  return (
    <StickyActionBar
      notice={<SwapPriceImpactNotice {...impactReview} isSubmitting={isSubmitting} />}
      summary={accountType === "safe" ? undefined : <SwapDecisionSummary
        requestId={requestId} disabled={isSubmitting} onRefreshQuote={onRefreshQuote}
        transactions={gasTransactions}
        fromAddress={fromAddress}
        accountId={accountId}
        accountType={accountType}
        chainId={chainId}
        isBatched={isBatched}
        batchedTx={gasBatchedTx?.tx}
        eip7702Delegate={eip7702Delegate}
        feePaymentToken={feePaymentToken}
        feePaymentQuote={feePaymentQuote}
        onFeePaymentTokenChange={setFeePaymentToken}
        onFeePaymentQuoteChange={setFeePaymentQuote}
        onGasEstimates={
            !isBatched || eip7702Delegate || accountType === "privateKey" || accountType === "seedPhrase"
              ? onGasEstimates
              : undefined
          }
        onValidityChange={
            !isBatched || eip7702Delegate || accountType === "privateKey" || accountType === "seedPhrase"
              ? onValidityChange
              : undefined
          }
      />}
      primaryAction={isSubmitting ? (
        <HStack
              justify="center"
              py={3}
              bg="accent.highlight"
              border="1px solid"
              borderColor="border.default"
              borderRadius="lg"
            >
              <Spinner size="sm" color="accentFg.highlight" />
              <Text fontSize="sm" color="accentFg.highlight" fontWeight="600">
                {accountType === "safe" ? "Creating proposal..." : isBridge ? "Bridging..." : "Submitting swap..."}
              </Text>
        </HStack>
      ) : (
        <Button
          variant="brand"
          onClick={() => onConfirm(feePaymentToken, feePaymentQuote?.quoteId ?? null)}
          isDisabled={
            isConfirmDisabled || impactReview.decision.blocked ||
            (feePaymentToken === "native" && !isNativeGasValid) ||
            (feePaymentToken !== "native" && !feePaymentQuote?.quoteId)
          }
        >
          {titleLabel}
        </Button>
      )}
      secondaryAction={isSubmitting ? undefined : (
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
      )}
    />
  );
}
