import AssetChangesDisplay from "@/components/AssetChangesDisplay";
import type { BunkerOperationSummary } from "@/chrome/safeBunker/types";

export function BunkerAssetPreview({ safe, chainId, chainName, operation, onLoadingChange, onUnavailableChange, onRevertedChange }: {
  onRevertedChange: (reverted: boolean) => void;
  chainId: number; chainName: string; safe: string; operation: BunkerOperationSummary; onLoadingChange: (loading: boolean) => void; onUnavailableChange: (unavailable: boolean) => void;
}) {
  return <AssetChangesDisplay txRequest={{ id: `bunker-preview:${operation.id}`, tx: { chainId, from: safe, to: operation.calls[0]?.to ?? safe },
      origin: operation.origins.join(", "), favicon: null, chainName, timestamp: operation.createdAt }}
      safeAddress={safe} batchCalls={operation.calls} embedded onSimulationLoadingChange={onLoadingChange}
      onRevertedChange={onRevertedChange} onSimulationUnavailableChange={onUnavailableChange} />;
}
