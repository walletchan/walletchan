import { useEffect, useRef } from "react";
import { formatUnits } from "viem";
import type { PortfolioToken } from "@/chrome/portfolio/api";
import { NATIVE_TOKEN_ADDRESS } from "@/chrome/swapApi";
import type { BunkerSwapContext } from "@/chrome/safeBunker/swapContext";
import type { BunkerAccountView, BunkerOperationSummary } from "@/chrome/safeBunker/types";
import type { SafeBunkerAccount } from "@/chrome/types";
import type { BunkerReviewPresentation } from "@/components/SafeBunker/BunkerTransactionConfirmation";
import SwapConfirmation from "./SwapConfirmation";
import { SwapPriceImpactNotice } from "./SwapPriceImpactNotice";
import { useSwapPriceImpactDecision } from "./useSwapPriceImpactDecision";

export interface BunkerSwapResume { requestId: string; chainId: number; context: BunkerSwapContext }
export function bunkerSwapSellToken(context: BunkerSwapContext, chainId: number): PortfolioToken {
  const t = context.sell, balance = formatUnits(BigInt(t.amount), t.decimals);
  return { contractAddress: t.address, name: t.name, symbol: t.symbol, decimals: t.decimals, balance,
    balanceFormatted: balance, priceUsd: t.priceUsd, valueUsd: Number(balance) * t.priceUsd, logoUrl: t.logo ?? undefined, chainId };
}

/** Reopened requests use the same swap overview and fresh acknowledgement state. */
export function useBunkerSwapPresentation(account: SafeBunkerAccount, view: BunkerAccountView, operation: BunkerOperationSummary): BunkerReviewPresentation | undefined {
  const context = operation.swapContext;
  const sellAmount = context ? formatUnits(BigInt(context.sell.amount), context.sell.decimals) : "0";
  const sellUsd = Number(sellAmount) * (context?.sell.priceUsd ?? 0);
  const impactReview = useSwapPriceImpactDecision({ inputUsd: sellUsd, outputAmount: context?.buy.amount,
    buyTokenDecimals: context?.buy.decimals, buyTokenPriceUsd: context?.buy.priceUsd ?? 0,
    quoteLoading: false, reviewContext: [operation.id, context] });
  if (!context) return undefined;
  return { title: "Confirm Swap", confirmLabel: "Confirm Swap", rejectLabel: "Cancel", blocked: impactReview.decision.blocked,
    notice: busy => <SwapPriceImpactNotice {...impactReview} isSubmitting={busy} />,
    content: estimatedChanges => <SwapConfirmation embedded transactionDetails={estimatedChanges} impactReview={impactReview}
      requestId={operation.id} transactions={operation.calls.map(tx => ({ tx: { ...tx, chainId: view.chainId, from: account.address }, origin: "WalletChan", favicon: null }))}
      sellToken={bunkerSwapSellToken(context, view.chainId)} sellAmount={sellAmount} sellUsd={sellUsd}
      buyTokenInfo={context.buy} buyAmount={context.buy.amount} buyTokenDecimals={context.buy.decimals} buyTokenLogoURI={context.buy.logo ?? undefined}
      isBuyNative={context.buy.address.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase()} buyUsd={impactReview.outputUsd}
      chainId={view.chainId} chainName={view.chainName} fromAddress={account.address} accountId={account.id} accountType="safeBunker"
      isBatched={operation.calls.length > 1} isSubmitting={false} onConfirm={() => {}} onCancel={() => {}} /> };
}


/** An explicit refresh re-enters the standard firm-quote preparation once data is ready. */
export function useResumeSwapReview(resume: BunkerSwapResume | undefined, canSwap: boolean, stagePlan: () => Promise<void>) {
  const started = useRef(false);
  useEffect(() => {
    if (!resume || started.current || !canSwap) return;
    started.current = true; void stagePlan();
  }, [resume, canSwap, stagePlan]);
}
