import { useEffect, useRef, useState } from "react";
import { Button, Text, VStack } from "@chakra-ui/react";
import { StickyActionBar } from "@/components/ui";
import { GasFeeLoading } from "@/components/GasEstimate/GasFeeLoading";
import type { BunkerAccountView } from "@/chrome/safeBunker/types";
import type { GasOverrides } from "@/chrome/transactions/localExecution";
import { bunkerCommand } from "./transport";
import { PayerFields } from "./PayerFields";
import { BunkerGasFields } from "./GasFields";

/** Shared deployment controls for network setup and an existing pending deployment. */
export function BunkerDeploymentFooter({ view, chainId, onViewChange, onActivated, disabled = false, preparing = false, onBusyChange }: {
  view: BunkerAccountView | null; chainId: number; onViewChange: (view: BunkerAccountView) => void;
  onActivated: (accountId: string) => void; disabled?: boolean; preparing?: boolean; onBusyChange?: (busy: boolean) => void;
}) {
  const [payer, setPayer] = useState("");
  const [gas, setGas] = useState<GasOverrides | null>(null), [gasPayer, setGasPayer] = useState("");
  const [estimating, setEstimating] = useState(false), [estimateError, setEstimateError] = useState("");
  const [estimateRevision, setEstimateRevision] = useState(0);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const claim = useRef(false), mounted = useRef(true);
  const id = view?.draftId;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!view) return;
    setPayer(previous => previous || view.deploymentPayerId || view.defaultPayer?.id || "");
    if (view.deploymentHash && view.deploymentGas) setGas(view.deploymentGas);
  }, [view]);
  useEffect(() => {
    let current = true;
    if (!payer || !id || view?.deploymentHash || view?.recovering) { setEstimating(false); return; }
    setGas(null); setGasPayer(""); setEstimateError(""); setEstimating(true);
    void bunkerCommand<{ gas: GasOverrides }>({ type: "estimateSafeBunkerDeployment", id, payerId: payer })
      .then(result => { if (current) { setGas(result.gas); setGasPayer(payer); } })
      .catch((e: Error) => { if (current) setEstimateError(e.message); })
      .finally(() => { if (current) setEstimating(false); });
    return () => { current = false; };
  }, [id, payer, view?.deploymentHash, view?.recovering, estimateRevision]);
  const needsEstimate = !!view && !view.deploymentHash && !view.recovering;
  const gasReady = !!gas && gasPayer === payer && !estimating && !estimateError;
  const run = async (work: () => Promise<void>) => {
    if (claim.current || disabled || !view || !id) return;
    claim.current = true; setBusy(true); onBusyChange?.(true); setError("");
    try { await work(); }
    catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "Operation unavailable"); }
    finally { claim.current = false; if (mounted.current) { setBusy(false); onBusyChange?.(false); } }
  };
  const accept = (next: BunkerAccountView) => {
    if (!mounted.current) return;
    if (next.deploymentHash || next.deployed && !next.archived) onActivated(next.id);
    else onViewChange(next);
  };
  const submit = async () => {
    if (!view || !id) return;
    if (view.recovering) {
      const result = await bunkerCommand<{ view: BunkerAccountView }>({ type: "continueSafeBunkerRecovery", id });
      accept(result.view); return;
    }
    if (view.deploymentHash) {
      await bunkerCommand({ type: "reconcileSafeBunker", id });
      const result = await bunkerCommand<{ view: BunkerAccountView }>({ type: "getSafeBunkerView", id });
      if (result.view.deployed) accept(result.view); else if (mounted.current) onViewChange(result.view);
      return;
    }
    if (!gasReady || !gas) return;
    const result = await bunkerCommand<{ view: BunkerAccountView }>({ type: "deploySafeBunker", id, payerId: payer, gas, remember: false });
    accept(result.view);
  };
  return <StickyActionBar summary={<VStack align="stretch" spacing={2}>
    <PayerFields chainId={chainId} compact deployment value={payer} onChange={next => { if (next === payer) return; setPayer(next); setGas(null); setEstimateError(""); setError(""); }} remember={false} onRemember={() => {}} disabled={busy || disabled || !!view?.deploymentHash} />
    {payer && (preparing || needsEstimate) && (estimating || !gas && !estimateError) && <GasFeeLoading />}
    {gas && (!needsEstimate || gasReady) && <BunkerGasFields symbol={view?.nativeCurrencySymbol ?? ""} compact key={`${id}:${payer}:${estimateRevision}`} value={gas} onChange={setGas} disabled={busy || disabled || !!view?.deploymentHash} />}
    {estimateError && needsEstimate && <VStack align="stretch" spacing={2}>
      <Text role="alert" color="status.error.emphasis" fontSize="sm">{estimateError}</Text>
      <Button size="sm" variant="secondary" isDisabled={busy || estimating} onClick={() => setEstimateRevision(n => n + 1)}>Retry gas estimate</Button>
    </VStack>}
    {view?.deploymentHash && gas && <Button variant="secondary" isDisabled={busy || disabled} onClick={() => void run(async () => {
      await bunkerCommand({ type: "deploySafeBunker", id, payerId: payer, gas, remember: false });
      if (mounted.current) onActivated(view.id);
    })}>Retry exact deployment</Button>}
    {error && <Text role="alert" color="status.error.emphasis" fontSize="sm">{error}</Text>}
  </VStack>} primaryAction={<Button variant="brand" isLoading={busy} isDisabled={disabled || !view || needsEstimate && !gasReady}
    onClick={() => void run(submit)}>{view?.recovering ? "Continue recovery" : view?.deploymentHash ? "Check deployment" : "Deploy"}</Button>} />;
}
