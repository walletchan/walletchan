import { BunkerAccountScreen } from "@/components/SafeBunker/BunkerAccountScreen";
import { AppHeader, AppScreen, ScreenBody } from "@/components/ui";
import { Text } from "@chakra-ui/react";
import SwapConfirmation from "./SwapConfirmation";
import { SwapPriceImpactNotice } from "./SwapPriceImpactNotice";
import type { SwapConfirmationProps } from "./swapViewTypes";

/** One review/decision surface; the Bunker coordinator retains all signing authority. */
export function BunkerSwapConfirmation(props: SwapConfirmationProps & { onSwapInitiated: () => void }) {
  const account = props.bunkerAccount;
  if (!account || account.id !== props.accountId || account.chainId !== props.chainId ||
    account.address.toLowerCase() !== props.fromAddress.toLowerCase() || props.bridgeMeta) {
    return <AppScreen><AppHeader title="Confirm Swap" onBack={props.onCancel} /><ScreenBody><Text role="alert" color="status.error.emphasis">Bunker swap account unavailable.</Text></ScreenBody></AppScreen>;
  }
  return <BunkerAccountScreen key={props.requestId} account={account}
    initialRequestId={props.requestId} isPopup={props.isPopup} rejectOnBack
    onBack={props.onCancel} onSubmitted={props.onSwapInitiated} onRefreshSwap={props.onRefreshBunkerSwap}
    presentation={{ title: "Confirm Swap", confirmLabel: "Confirm Swap", rejectLabel: "Cancel",
      blocked: props.isSubmitting || props.impactReview.decision.blocked || props.isConfirmDisabled === true,
      content: estimatedChanges => <SwapConfirmation {...props} embedded transactionDetails={estimatedChanges} />,
      notice: busy => <SwapPriceImpactNotice {...props.impactReview} isSubmitting={busy} /> }} />;
}
