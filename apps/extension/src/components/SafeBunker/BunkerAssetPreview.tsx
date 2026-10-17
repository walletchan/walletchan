import { useEffect, useRef, useState } from "react";
import AssetChangesDisplay from "@/components/AssetChangesDisplay";
import type { BunkerOperationSummary } from "@/chrome/safeBunker/types";

export function BunkerAssetPreview({ safe, chainId, chainName, operation, onValidityChange, onUnavailableChange }: {
  chainId: number; chainName: string; safe: string; operation: BunkerOperationSummary; onValidityChange: (valid: boolean) => void; onUnavailableChange: (unavailable: boolean) => void;
}) {
  const [loading, setLoading] = useState(true), [reverted, setReverted] = useState(false);
  const callback = useRef(onValidityChange); callback.current = onValidityChange;
  useEffect(() => { callback.current(!loading && !reverted); }, [loading, reverted]);
  return <AssetChangesDisplay txRequest={{ id: `bunker-preview:${operation.id}`, tx: { chainId, from: safe, to: operation.calls[0]?.to ?? safe },
      origin: operation.origins.join(", "), favicon: null, chainName, timestamp: operation.createdAt }}
      safeAddress={safe} batchCalls={operation.calls} embedded onSimulationLoadingChange={setLoading}
      onRevertedChange={setReverted} onSimulationUnavailableChange={onUnavailableChange} />;
}
