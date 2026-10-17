import { ChevronRightIcon } from "@chakra-ui/icons";
import { useEffect, useRef, useState } from "react";
import { Button, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import type { SeedGroup } from "@/chrome/types";
import { AppHeader, AppScreen, ListItem, ListItemActions, ListItemContent, ListItemMedia, ListItemTitle, ListSurface, ScreenBody, ScreenSection } from "@/components/ui";
import { SeedIcon } from "@/components/shared/AccountTypeIcons";
import { LocalAccountBiometricGateStatus } from "@/components/AddAccount/LegacyBiometricUpgradeNotice";
import { BunkerSetupIntro } from "./BunkerSetupIntro";
import { BunkerSourceSetup } from "./BunkerSourceSetup";
import { BunkerNetworkSetup } from "./BunkerNetworkSetup";
import { BunkerChainPills } from "./BunkerChainPills";
import { useBunkerDiscovery } from "./useBunkerDiscovery";

function SourceSelection({ onBack, onActivated }: { onBack: () => void; onActivated: (id: string) => void }) {
  const [group, setGroup] = useState<SeedGroup | null>(null), [create, setCreate] = useState(false);
  const [addedSeedGroupIds, setAddedSeedGroupIds] = useState<string[]>([]);
  const discovery = useBunkerDiscovery(!create ? group?.id : undefined);
  if (create) return <BunkerSourceSetup onBack={() => setCreate(false)} onSaved={(saved) => { setAddedSeedGroupIds(ids => [...ids, saved.id]); setCreate(false); discovery.refresh(); setGroup(saved); }} />;
  if (group) return <BunkerNetworkSetup group={group} isNewSource={addedSeedGroupIds.includes(group.id)} discovery={discovery} onBack={() => { setGroup(null); discovery.refresh(); }} onAdded={onActivated} />;
  return <AppScreen><AppHeader title="Safe Bunker" onBack={onBack} /><ScreenBody pt={5}>
    <VStack align="stretch" spacing={5}>
      <ScreenSection title="Saved seed phrases"><ListSurface>{discovery.groups.map(saved => <ListItem key={saved.id} flexDirection="column" alignItems="stretch" gap={2}>
        <HStack spacing={3} w="full" minW={0}>
          <ListItemMedia><SeedIcon boxSize="18px" color="accent.primary" /></ListItemMedia>
          <ListItemContent><ListItemTitle>{saved.name}</ListItemTitle></ListItemContent>
          <ListItemActions><Button variant="secondary" size="sm" onClick={() => setGroup(saved)} rightIcon={<ChevronRightIcon aria-hidden="true" />}>Proceed</Button></ListItemActions>
        </HStack>
        <BunkerChainPills iconsOnly networks={discovery.networks} results={discovery.localResults[saved.id] ?? {}} />
      </ListItem>)}</ListSurface></ScreenSection>
      {discovery.loading && <HStack role="status"><Spinner size="sm" /><Text fontSize="sm" color="fg.secondary">Loading seed phrases…</Text></HStack>}
      {!discovery.loading && discovery.groups.length === 0 && !discovery.error && <Text color="fg.secondary" fontSize="sm">Create or import a seed phrase to get started.</Text>}
      {discovery.error && <VStack align="stretch"><Text role="alert" fontSize="sm" color="status.error.emphasis">{discovery.error}</Text><Button variant="secondary" onClick={discovery.refresh}>Retry</Button></VStack>}
      <Button variant="secondary" onClick={() => setCreate(true)}>Create or import a seed phrase</Button>
    </VStack>
  </ScreenBody></AppScreen>;
}
export function SafeBunkerDraftScreen({ onBack, onActivated = onBack, ensureMnemonicAccess, needsUpgrade = false, onOpenBiometricSettings = onBack }: {
  onBack: () => void; onActivated?: (accountId: string) => void;
  ensureMnemonicAccess?: () => Promise<{ ready: boolean }>; needsUpgrade?: boolean | null;
  onOpenBiometricSettings?: () => void;
}) {
  const [intro, setIntro] = useState(true), [ready, setReady] = useState(false), [checking, setChecking] = useState(false);
  const generation = useRef(0);
  useEffect(() => () => { ++generation.current; }, []);
  const proceed = async () => {
    const revision = ++generation.current; setIntro(false); setChecking(true);
    try { const access = ensureMnemonicAccess ? await ensureMnemonicAccess() : { ready: true }; if (generation.current === revision) setReady(access.ready); }
    catch { if (generation.current === revision) setReady(false); }
    finally { if (generation.current === revision) setChecking(false); }
  };
  if (intro) return <BunkerSetupIntro onBack={onBack} onProceed={() => void proceed()} />;
  if (!ready) return <AppScreen><AppHeader title="Safe Bunker" onBack={() => setIntro(true)} /><ScreenBody pt={5}>
    <LocalAccountBiometricGateStatus needsUpgrade={needsUpgrade} onOpenBiometricSettings={onOpenBiometricSettings} />
    <Button variant="secondary" isLoading={checking} onClick={() => void proceed()}>Continue</Button>
  </ScreenBody></AppScreen>;
  return <SourceSelection onBack={() => setIntro(true)} onActivated={onActivated} />;
}
