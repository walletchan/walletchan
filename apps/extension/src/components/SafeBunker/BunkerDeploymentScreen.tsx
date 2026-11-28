import { useEffect, useRef, useState } from "react";
import { Skeleton, Text, VStack } from "@chakra-ui/react";
import { AppHeader, AppScreen, ScreenBody } from "@/components/ui";
import type { BunkerAccountView } from "@/chrome/safeBunker/types";
import AccountSettingsIdentity from "@/components/AccountSettingsIdentity";
import { BunkerDeploymentFooter } from "./BunkerDeploymentFooter";
import { bunkerCommand } from "./transport";

export function BunkerDeploymentScreen({ id, onBack, onActivated }: { id: string; onBack: () => void; onActivated: (accountId: string) => void }) {
  const [view, setView] = useState<BunkerAccountView | null>(null), [error, setError] = useState("");
  const generation = useRef(0), activated = useRef(onActivated); activated.current = onActivated;
  useEffect(() => { const revision = ++generation.current;
    void bunkerCommand<{ view: BunkerAccountView }>({ type: "prepareSafeBunker", id }).then(r => {
      if (generation.current !== revision) return;
      setView(r.view); if (r.view.deployed && !r.view.archived) activated.current(r.view.id);
    }).catch((e: Error) => { if (generation.current === revision) setError(e.message); });
    return () => { generation.current = revision + 1; };
  }, [id]);
  return <AppScreen><AppHeader title="Deploy Bunker" onBack={onBack} /><ScreenBody pt={5}>
    <VStack align="stretch" spacing={5}>
      {view ? <VStack align="stretch" spacing={2}>
        <AccountSettingsIdentity account={{ id: view.id, type: "safeBunker", displayName: view.name, address: view.safeAddress, chainId: view.chainId, bunkerId: id, seedGroupId: view.seedGroupId, derivationVersion: 2, createdAt: 0 }} resolvedName={null} resolvedAvatar={null} explorerUrl={view.explorer ? `${view.explorer}/address/${view.safeAddress}` : undefined} />
        <Text fontSize="xs" color="fg.secondary">{view.chainName}</Text>
      </VStack> : <Skeleton h="64px" borderRadius="lg" />}
      {view?.deploymentHash && <Text color="fg.secondary" fontSize="sm" overflowWrap="anywhere">Deployment submitted. Check after 3 confirmations.</Text>}
      {error && <Text role="alert" color="status.error.emphasis" fontSize="sm">{error}</Text>}
    </VStack>
  </ScreenBody><BunkerDeploymentFooter key={id} view={view} chainId={view?.chainId ?? 0} onViewChange={setView} onActivated={onActivated} /></AppScreen>;
}
