import { useEffect, useRef, useState } from "react";
import { CheckIcon, ChevronRightIcon, ViewIcon } from "@chakra-ui/icons";
import { Button, Skeleton, Text, VStack } from "@chakra-ui/react";
import { AppHeader, AppScreen, ListItem, ListItemActions, ListItemContent, ListItemDescription, ListItemMedia, ListItemTitle, ListSurface, ScreenBody, StickyActionBar } from "@/components/ui";
import type { BunkerAccountView } from "@/chrome/safeBunker/types";
import type { GasOverrides } from "@/chrome/transactions/localExecution";
import AccountSettingsIdentity from "@/components/AccountSettingsIdentity";
import RevealSeedPhrase from "@/components/RevealSeedPhrase";
import { useSeedBackupState } from "@/components/SeedBackup/useSeedBackupState";
import { bunkerCommand } from "./transport";
import { PayerFields } from "./PayerFields";
import { BunkerGasFields } from "./GasFields";
import { GasFeeLoading } from "@/components/GasEstimate/GasFeeLoading";

export function BunkerDeploymentScreen({ id, onBack, onActivated }: { id: string; onBack: () => void; onActivated: (accountId: string) => void }) {
  const [view, setView] = useState<BunkerAccountView | null>(null), [payer, setPayer] = useState("");
  const [reveal, setReveal] = useState(false);
  const backup = useSeedBackupState(view?.draftId);
  const [gas, setGas] = useState<GasOverrides | null>(null);
  const [gasPayer, setGasPayer] = useState("");
  const [estimating, setEstimating] = useState(false), [estimateError, setEstimateError] = useState("");
  const [estimateRevision, setEstimateRevision] = useState(0);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const generation = useRef(0), claim = useRef(false);
  const activated = useRef(onActivated); activated.current = onActivated;
  const run = async (work: () => Promise<void>) => {
    if (claim.current) return; claim.current = true; setBusy(true); setError("");
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : "Operation unavailable"); }
    finally { claim.current = false; setBusy(false); }
  };
  useEffect(() => { const revision = ++generation.current;
    void bunkerCommand<{ view: BunkerAccountView }>({ type: "prepareSafeBunker", id }).then((r) => {
      if (generation.current === revision) { setView(r.view); setPayer((previous) => previous || r.view.deploymentPayerId || r.view.defaultPayer?.id || ""); if (r.view.deploymentGas) setGas(r.view.deploymentGas); if (r.view.deployed && !r.view.archived) activated.current(r.view.id); }
    }).catch((e: Error) => { if (generation.current === revision) setError(e.message); });
    return () => { generation.current = revision + 1; };
  }, [id]);
  useEffect(() => {
    let current = true;
    if (!payer || !view?.draftId || view.deploymentHash || view.recovering) { setEstimating(false); return; }
    setGas(null); setGasPayer(""); setEstimateError(""); setEstimating(true);
    void bunkerCommand<{ gas: GasOverrides }>({ type: "estimateSafeBunkerDeployment", id, payerId: payer })
      .then((result) => { if (current) { setGas(result.gas); setGasPayer(payer); } })
      .catch((e: Error) => { if (current) setEstimateError(e.message); })
      .finally(() => { if (current) setEstimating(false); });
    return () => { current = false; };
  }, [id, payer, view?.draftId, view?.deploymentHash, view?.recovering, estimateRevision]);
  const needsEstimate = !!view && !view.deploymentHash && !view.recovering;
  const gasReady = !!gas && gasPayer === payer && !estimating && !estimateError;
  const refresh = async () => {
    await bunkerCommand({ type: "reconcileSafeBunker", id });
    const result = await bunkerCommand<{ view: BunkerAccountView }>({ type: "getSafeBunkerView", id });
    setView(result.view); if (result.view.deployed) onActivated(result.view.id);
  };
  if (reveal) return <RevealSeedPhrase account={null} bunkerDraftId={id} onBack={() => setReveal(false)} />;
  return <AppScreen><AppHeader title="Deploy Bunker" onBack={onBack} /><ScreenBody pt={5}>
    <VStack align="stretch" spacing={5}>
      {view ? <VStack align="stretch" spacing={2}>
        <AccountSettingsIdentity account={{ id: view.id, type: "safeBunker", displayName: view.name, address: view.safeAddress, chainId: view.chainId, seedVaultId: id, derivationVersion: 1, createdAt: 0 }} resolvedName={null} resolvedAvatar={null} explorerUrl={`https://sepolia.etherscan.io/address/${view.safeAddress}`} />
        <Text fontSize="xs" color="fg.secondary">Sepolia testnet</Text>
      </VStack> : <Skeleton h="64px" borderRadius="lg" />}
      <ListSurface><ListItem interactive as="button" type="button" w="full" textAlign="left" density="compact" aria-disabled={!view || busy} onClick={() => { if (view && !busy) setReveal(true); }}>
        <ListItemMedia><ViewIcon boxSize={4} color="fg.secondary" /></ListItemMedia>
        <ListItemContent><ListItemTitle>Reveal recovery phrase</ListItemTitle><ListItemDescription>{!view || backup.isLoading ? "" : backup.error ? "Reveal and back up your recovery phrase" : backup.pending ? "Back up now or later from your wallet" : "Recovery phrase backed up"}</ListItemDescription></ListItemContent>
        <ListItemActions>{view && !backup.error && !backup.pending && !backup.isLoading ? <CheckIcon color="status.success.emphasis" boxSize={3} /> : <ChevronRightIcon boxSize={4} />}</ListItemActions>
      </ListItem></ListSurface>
      {view?.deploymentHash && <Text color="fg.secondary" fontSize="sm" overflowWrap="anywhere">Deployment submitted. Check after 3 confirmations.</Text>}
      {view?.deploymentHash && gas && <Button variant="secondary" isDisabled={busy} onClick={() => void run(async () => { await bunkerCommand({ type: "deploySafeBunker", id, payerId: payer, gas, remember: false }); activated.current(view.id); })}>Retry exact deployment</Button>}
      {error && <Text role="alert" color="status.error.emphasis" fontSize="sm">{error}</Text>}
    </VStack>
  </ScreenBody><StickyActionBar summary={<VStack align="stretch" spacing={2}>
    <PayerFields compact deployment value={payer} onChange={(id) => { if (id === payer) return; setPayer(id); setGas(null); setEstimateError(""); setError(""); }} remember={false} onRemember={() => {}} disabled={busy || !view || !!view.deploymentHash} />
    {payer && needsEstimate && (estimating || !gas && !estimateError) && <GasFeeLoading />}
    {gas && (!needsEstimate || gasReady) && <BunkerGasFields compact key={`${id}:${payer}:${estimateRevision}`} value={gas} onChange={setGas} disabled={busy || !!view?.deploymentHash} />}
    {estimateError && needsEstimate && <VStack align="stretch" spacing={2}>
      <Text role="alert" color="status.error.emphasis" fontSize="sm">{estimateError}</Text>
      <Button size="sm" variant="secondary" isDisabled={busy || estimating} onClick={() => setEstimateRevision((n) => n + 1)}>Retry gas estimate</Button>
    </VStack>}
  </VStack>} primaryAction={<Button variant="brand" isLoading={busy} isDisabled={!view || needsEstimate && !gasReady}
    onClick={() => void run(async () => {
      if (view?.recovering) {
        const result = await bunkerCommand<{ view: BunkerAccountView }>({ type: "continueSafeBunkerRecovery", id });
        setView(result.view); if (result.view.deployed) activated.current(result.view.id); return;
      }
      if (view?.deploymentHash) return refresh();
      if (!gasReady || !gas) return;
      const result = await bunkerCommand<{ view: BunkerAccountView }>({ type: "deploySafeBunker", id, payerId: payer, gas, remember: false });
      if (result.view.deploymentHash) { activated.current(result.view.id); return; }
      setView(result.view);
    })}>{view?.recovering ? "Continue recovery" : view?.deploymentHash ? "Check deployment" : "Deploy"}</Button>} /></AppScreen>;
}
