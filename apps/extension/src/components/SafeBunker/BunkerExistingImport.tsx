import { useEffect, useRef, useState } from "react";
import { Button, Checkbox, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { ListItem, ListSurface, ScreenSection } from "@/components/ui";
import ChainIcon from "@/components/ChainIcon";
import MiddleTruncatedAddress from "@/components/MiddleTruncatedAddress";
import type { useBunkerDiscovery } from "./useBunkerDiscovery";
import { noBunkersFound } from "./discoveryModel";
import { bunkerCommand } from "./transport";

/** Shared existing-account import only; never creates a deployment or an EOA. */
export function BunkerExistingImport({ seedGroupId, discovery, autoSearch = false, disabled = false, onAdded, onBusyChange, onCommitted }: {
  seedGroupId: string; discovery: ReturnType<typeof useBunkerDiscovery>; autoSearch?: boolean; disabled?: boolean;
  onAdded: (accountId: string, chainId: number) => void; onBusyChange?: (busy: boolean) => void; onCommitted?: () => void;
}) {
  const [selected, setSelected] = useState<number[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [imported, setImported] = useState<{ id: string; chainId: number } | null>(null);
  const claimed = useRef(false), searched = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const { networks, loading, checking } = discovery, rows = discovery.results[seedGroupId] ?? {};
  useEffect(() => {
    if (!autoSearch || searched.current || loading || !networks.length) return;
    searched.current = true; void discovery.find();
  }, [autoSearch, loading, networks.length, discovery]);
  const existing = networks.filter(n => rows[n.chainId]?.status === "deployed");
  const foundAddress = (id: number) => { const row = rows[id]; return row && "address" in row ? row.address : undefined; };
  const failures = networks.filter(n => rows[n.chainId]?.status === "error");
  const add = async () => {
    if (claimed.current) return; claimed.current = true; setBusy(true); onBusyChange?.(true); setError("");
    let last: { id: string; chainId: number } | null = null;
    try {
      for (const chainId of selected.filter(id => rows[id]?.status === "deployed")) {
        const result = await bunkerCommand<{ accountId: string }>({ type: "addExistingSafeBunker", seedGroupId, chainId });
        last = { id: result.accountId, chainId };
        if (!alive.current) return;
        setImported(last); onCommitted?.(); setSelected(old => old.filter(id => id !== chainId));
      }
      if (last && alive.current) onAdded(last.id, last.chainId);
    } catch (cause) {
      if (alive.current) { setError(cause instanceof Error ? cause.message : "Could not import Bunkers"); discovery.refresh(); }
    } finally { claimed.current = false; if (alive.current) { setBusy(false); onBusyChange?.(false); } }
  };
  return <VStack align="stretch" spacing={3}>
    {!autoSearch && <Button variant="secondary" isLoading={checking} loadingText="Checking for existing Bunkers…" isDisabled={disabled || busy || loading || !networks.length} onClick={() => void discovery.find()}>Find already deployed Bunkers</Button>}
    {autoSearch && (loading || checking) && <HStack role="status"><Spinner size="sm" /><Text color="fg.secondary" fontSize="sm">Checking for existing Bunkers…</Text></HStack>}
    {existing.length > 0 && <ScreenSection title={autoSearch ? "Select Bunkers" : "Add existing"} headingProps={{ fontSize: "sm", fontWeight: 600, color: "fg.secondary" }}>
      <VStack align="stretch" spacing={3}><ListSurface>{existing.map(network => <ListItem key={network.chainId} p={0} minH={0}>
        <Checkbox variant="commitment" sx={{ ".chakra-checkbox__control": { borderRadius: 0 } }} w="full" minH="56px" px={4} py={3} isChecked={selected.includes(network.chainId)} isDisabled={disabled || busy}
          onChange={event => setSelected(old => event.target.checked ? [...old, network.chainId] : old.filter(id => id !== network.chainId))}>
          <HStack spacing={2}><ChainIcon chainId={network.chainId} chainName={network.name} size="22px" /><Text fontSize="sm">{network.name}</Text>
            {autoSearch && foundAddress(network.chainId) && <Text fontSize="xs" color="fg.secondary"><MiddleTruncatedAddress address={foundAddress(network.chainId)!} /></Text>}
          </HStack>
        </Checkbox>
      </ListItem>)}</ListSurface>
      <Button size={autoSearch ? "md" : "sm"} variant="brand" isLoading={busy} isDisabled={disabled || !selected.length} onClick={() => void add()}>{autoSearch ? "Import selected Bunkers" : "Add selected accounts"}</Button></VStack>
    </ScreenSection>}
    {discovery.searched && !checking && noBunkersFound(networks.map(n => n.chainId), rows) && <Text role="status" fontSize="sm" color="fg.secondary">No Safe Bunkers found for this phrase.</Text>}
    {(failures.length > 0 || discovery.error || error || !loading && !networks.length) && <VStack align="stretch" spacing={2}>
      <Text role="alert" fontSize="sm" color="status.error.emphasis">{error || discovery.error || (!networks.length ? "No supported networks available. Retry to check again." : `Couldn’t check ${failures.length} ${failures.length === 1 ? "network" : "networks"} (${failures.map(network => network.name).join(", ")}).`)}</Text>
      <Button size="sm" variant="secondary" isDisabled={disabled || busy || checking} onClick={() => { if (!networks.length) { searched.current = false; discovery.refresh(); } else void discovery.find(); }}>Retry</Button>
    </VStack>}
    {imported && error && <Button variant="brand" isDisabled={busy} onClick={() => onAdded(imported.id, imported.chainId)}>Continue with imported accounts</Button>}
  </VStack>;
}
