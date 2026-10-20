import { useEffect, useRef, useState } from "react";
import { Badge, Box, Button, Checkbox, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { ChevronDownIcon } from "@chakra-ui/icons";
import { AppHeader, AppScreen, ListItem, ListItemContent, ListItemMedia, ListItemTitle, ListSurface, ScreenBody, ScreenSection, StickyActionBar } from "@/components/ui";
import { NetworkSelectorScreen } from "@/components/shared/NetworkSelector";
import ChainIcon from "@/components/ChainIcon";
import { CopyButton } from "@/components/CopyButton";
import MiddleTruncatedAddress from "@/components/MiddleTruncatedAddress";
import type { SeedGroup } from "@/chrome/types";
import type { BunkerAccountView } from "@/chrome/safeBunker/types";
import { BunkerChainPills } from "./BunkerChainPills";
import type { useBunkerDiscovery } from "./useBunkerDiscovery";
import { canDeployBunker, deployedBunker, noBunkersFound } from "./discoveryModel";
import { BunkerDeploymentFooter } from "./BunkerDeploymentFooter";
import { bunkerCommand } from "./transport";
export function BunkerNetworkSetup({ group, isNewSource = false, discovery, onBack, onAdded }: {
  group: SeedGroup; isNewSource?: boolean; discovery: ReturnType<typeof useBunkerDiscovery>; onBack: () => void;
  onAdded: (id: string) => void;
}) {
  const { networks, loading, refresh } = discovery, rows = discovery.results[group.id] ?? {};
  const [picker, setPicker] = useState(false), [chainId, setChainId] = useState<number | null>(null);
  const [prepared, setPrepared] = useState<BunkerAccountView | null>(null), [preparing, setPreparing] = useState(false);
  const [selected, setSelected] = useState<number[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [deploying, setDeploying] = useState(false);
  const [preparationAttempt, setPreparationAttempt] = useState(0);
  const [preparationFailed, setPreparationFailed] = useState(false);
  const generation = useRef(0), adding = useRef(false);
  const network = networks.find(n => n.chainId === chainId);
  const ready = chainId !== null && canDeployBunker(rows[chainId]);
  const selectedView = ready && prepared?.chainId === chainId && prepared.seedGroupId === group.id ? prepared : null;
  useEffect(() => {
    const lifecycle = generation;
    const revision = ++lifecycle.current; setPrepared(null); setError(""); setPreparationFailed(false);
    if (!ready || chainId === null) { setPreparing(false); return; }
    setPreparing(true);
    void bunkerCommand<{ draft: { id: string } }>({ type: "createSafeBunkerDraft", seedGroupId: group.id, chainId })
      .then(r => bunkerCommand<{ view: BunkerAccountView }>({ type: "prepareSafeBunker", id: r.draft.id }))
      .then(r => { if (generation.current === revision) setPrepared(r.view); })
      .catch((e: Error) => { if (generation.current === revision) { setError(e.message); setPreparationFailed(true); } })
      .finally(() => { if (generation.current === revision) setPreparing(false); });
    return () => { ++lifecycle.current; };
  }, [group.id, chainId, ready, preparationAttempt]);
  const localRows = discovery.localResults[group.id] ?? {};
  const existing = networks.filter(n => rows[n.chainId]?.status === "deployed");
  const hasDeployed = networks.some(n => deployedBunker(localRows[n.chainId]));
  const failures = networks.filter(n => rows[n.chainId]?.status === "error");
  const checking = discovery.checking;
  const checkError = failures.length === 1 ? `Couldn’t check ${failures[0].name}` : `Couldn’t check ${failures.length} networks`;
  const add = async () => {
    if (adding.current) return; adding.current = true; setBusy(true); setError(""); setPreparationFailed(false);
    let last: string | undefined;
    try {
      for (const id of selected.filter(id => rows[id]?.status === "deployed")) {
        const result = await bunkerCommand<{ accountId: string }>({ type: "addExistingSafeBunker", seedGroupId: group.id, chainId: id });
        last = result.accountId; setSelected(old => old.filter(value => value !== id));
      }
      if (last) onAdded(last);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not add Bunkers"); refresh(); }
    finally { adding.current = false; setBusy(false); }
  };
  if (picker) return <NetworkSelectorScreen title="Choose network" networks={networks.map(n => ({ ...n, nativeSymbol: n.nativeCurrency.symbol,
    isSelectable: canDeployBunker(rows[n.chainId]), unavailableReason: rows[n.chainId]?.status === "pending" ? "Deployment pending" : "Already deployed" }))}
    selectedChainId={chainId} onSelect={id => { setChainId(id); setPicker(false); }} onBack={() => setPicker(false)} />;
  return <AppScreen><AppHeader title="Safe Bunker" onBack={onBack} isBackDisabled={deploying} trailing={<Box position="relative" pr={isNewSource ? "30px" : 0} mr={2}>
    <Text fontSize="sm" fontWeight={500} color="fg.secondary" maxW="140px" isTruncated title={group.name}>{group.name}</Text>
    {isNewSource && <Badge variant="warning" position="absolute" top="-7px" right={0} borderRadius="full" px={1.5} fontSize="9px" lineHeight="14px" textTransform="none" letterSpacing="normal">new</Badge>}
  </Box>} /><ScreenBody pt={5}>
    <VStack align="stretch" spacing={6}>
      {hasDeployed && <ScreenSection title="Already deployed on" headingProps={{ fontSize: "sm", fontWeight: 600, color: "fg.secondary" }}>
        <BunkerChainPills networks={networks} results={localRows} />
      </ScreenSection>}
      <ScreenSection title="Deploy on" headingProps={{ fontSize: "sm", fontWeight: 600, color: "fg.primary" }}>
        <VStack align="stretch" spacing={3}>
          <ListSurface><ListItem interactive aria-label={network ? `${network.name}, change network` : "Choose network"} onClick={() => setPicker(true)} isDisabled={busy || deploying}>
            {network && <ListItemMedia><ChainIcon chainId={network.chainId} chainName={network.name} size="24px" /></ListItemMedia>}
            <ListItemContent><ListItemTitle>{network?.name ?? "Choose network"}</ListItemTitle></ListItemContent>
            <ChevronDownIcon boxSize={5} color="fg.secondary" aria-hidden="true" />
          </ListItem></ListSurface>
          {preparing && <HStack role="status" spacing={2} px={1} mt={2}><Spinner size="xs" /><Text fontSize="sm" color="fg.secondary">Determining Safe address…</Text></HStack>}
          {selectedView && <ListSurface><ListItem><ListItemContent><ListItemTitle>Safe address</ListItemTitle>
            <HStack spacing={2} w="full"><Box flex={1} minW={0}><MiddleTruncatedAddress address={selectedView.safeAddress} /></Box><CopyButton value={selectedView.safeAddress} label="Copy Safe address" /></HStack></ListItemContent></ListItem></ListSurface>}
        </VStack>
      </ScreenSection>
      {chainId === null && <VStack align="stretch" spacing={3}>
        <Text textAlign="center" fontSize="sm" color="fg.secondary">or</Text>
        <Button variant="secondary" isLoading={checking} loadingText="Checking for existing Bunkers…" isDisabled={busy || loading || networks.length === 0} onClick={() => void discovery.find()}>Find already deployed Bunkers</Button>
      {existing.length > 0 && <ScreenSection title="Add existing" headingProps={{ fontSize: "sm", fontWeight: 600, color: "fg.secondary" }}>
        <VStack align="stretch" spacing={3}>
          <ListSurface>{existing.map(n => <ListItem key={n.chainId} p={0} minH={0}>
            <Checkbox variant="commitment" w="full" minH="56px" px={4} py={3}
              sx={{ ".chakra-checkbox__control": { borderRadius: 0 } }}
              _hover={busy || deploying ? undefined : { bg: "surface.raisedHover" }} isChecked={selected.includes(n.chainId)} isDisabled={busy || deploying} onChange={e => setSelected(old => e.target.checked ? [...old, n.chainId] : old.filter(id => id !== n.chainId))}>
              <HStack spacing={2}><ChainIcon chainId={n.chainId} chainName={n.name} size="22px" /><Text fontSize="sm">{n.name}</Text></HStack>
            </Checkbox>
          </ListItem>)}</ListSurface>
          <Button size="sm" variant="brand" isLoading={busy} isDisabled={!selected.length || deploying} onClick={() => void add()}>Add selected accounts</Button>
        </VStack>
      </ScreenSection>}
        {!checking && failures.length > 0 && <HStack spacing={2} px={1} minH="32px" align="center">
          <Text fontSize="sm" color="fg.secondary" flex={1} minW={0} title={failures.map(n => n.name).join(", ")}>{checkError}</Text>
          <Button size="xs" variant="ghost" minH="32px" px={2} flexShrink={0} isDisabled={busy || loading} onClick={() => void discovery.find()}>Retry</Button>
        </HStack>}
        {discovery.searched && !checking && noBunkersFound(networks.map(n => n.chainId), rows) && <Text role="status" fontSize="sm" color="fg.secondary">No bunkers found. Deploy on your desired chain</Text>}
      </VStack>}
      {(error || discovery.error) && <HStack align="start" spacing={2}>
        <Text role="alert" color="status.error.emphasis" fontSize="sm" flex={1} minW={0}>{error || discovery.error}</Text>
        {preparationFailed && ready && !prepared && !preparing && <Button variant="ghost" size="xs" minH="32px" flexShrink={0} isDisabled={busy || deploying} onClick={() => setPreparationAttempt(attempt => attempt + 1)}>Retry</Button>}
      </HStack>}
    </VStack>
  </ScreenBody>{chainId !== null ? <BunkerDeploymentFooter key={`${group.id}:${chainId}`} view={selectedView} chainId={chainId}
    preparing={preparing} onViewChange={setPrepared} onActivated={onAdded} onBusyChange={setDeploying} disabled={busy || !ready} />
    : <StickyActionBar primaryAction={<Button variant="brand" isDisabled>Continue</Button>} />}</AppScreen>;
}
