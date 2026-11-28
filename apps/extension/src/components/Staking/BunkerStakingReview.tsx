import type { SafeBunkerAccount } from "@/chrome/types";
import { BunkerAccountScreen } from "@/components/SafeBunker/BunkerAccountScreen";
import { VStack } from "@chakra-ui/react";
import { StakingReviewScreen } from "./StakingReviewScreen";
import type { PreparedStakingPlan } from "./types";

/** Staking uses the same Bunker execution/rotation boundary as Send and Swap. */
export function BunkerStakingReview({ account, plan, priceUsd, onBack, onSubmitted, isPopup }: {
  account: SafeBunkerAccount; plan: PreparedStakingPlan; priceUsd: number;
  onBack: () => void; onSubmitted: () => void; isPopup?: boolean;
}) {
  if (!plan.bunkerRequestId) return null;
  const label = plan.action === "claim" ? "Claim rewards" : plan.action === "stake" ? "Stake WCHAN" : "Unstake WCHAN";
  return <BunkerAccountScreen key={plan.bunkerRequestId} account={account} initialRequestId={plan.bunkerRequestId}
    isPopup={isPopup} rejectOnBack onBack={onBack} onSubmitted={onSubmitted}
    presentation={{ title: `Confirm ${plan.action}`, confirmLabel: label, rejectLabel: "Cancel", blocked: false,
      content: estimated => <VStack align="stretch" spacing={4}>
        <StakingReviewScreen embedded plan={plan} owner={account.address} accountType="safeBunker" priceUsd={priceUsd}
          submitting={false} onBack={onBack} onConfirm={() => {}} onGasEstimates={() => {}} />
        {estimated}
      </VStack> }} />;
}
