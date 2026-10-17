import { useEffect, useRef, useState } from "react";
import { Checkbox, VStack } from "@chakra-ui/react";
import AssetChangesDisplay from "@/components/AssetChangesDisplay";
import type { BunkerOperationSummary } from "@/chrome/safeBunker/types";

export function BunkerAssetPreview({ safe, chainId, chainName, operation, onValidityChange }: {
  chainId: number; chainName: string; safe: string; operation: BunkerOperationSummary; onValidityChange: (valid: boolean) => void;
}) {
  const [loading, setLoading] = useState(true), [reverted, setReverted] = useState(false);
  const [unavailable, setUnavailable] = useState(false), [ack, setAck] = useState(false);
  const callback = useRef(onValidityChange); callback.current = onValidityChange;
  useEffect(() => { callback.current(!loading && !reverted && (!unavailable || ack)); }, [loading, reverted, unavailable, ack]);
  return <VStack align="stretch" spacing={2}>
    <AssetChangesDisplay txRequest={{ id: `bunker-preview:${operation.id}`, tx: { chainId, from: safe, to: operation.calls[0]?.to ?? safe },
      origin: operation.origins.join(", "), favicon: null, chainName, timestamp: operation.createdAt }}
      safeAddress={safe} batchCalls={operation.calls} embedded onSimulationLoadingChange={setLoading}
      onRevertedChange={setReverted} onSimulationUnavailableChange={setUnavailable} />
    {unavailable && <Checkbox isChecked={ack} onChange={(e) => setAck(e.target.checked)}>Continue without an asset preview</Checkbox>}
  </VStack>;
}
