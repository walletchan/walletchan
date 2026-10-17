import { useEffect, useRef, useState } from "react";
import { Button, FormControl, FormLabel, Input, Spinner, Text, Textarea, VStack } from "@chakra-ui/react";
import { AppHeader, AppScreen, ScreenBody, StickyActionBar } from "@/components/ui";
import UnlockScreen from "@/components/UnlockScreen";
import type { BunkerAccountView } from "@/chrome/safeBunker/types";
import { BunkerSetupTabs } from "./BunkerSetupTabs";
import { completeBunkerRestore } from "./restoreProgress";
import { bunkerCommand } from "./transport";

type RestoreSession = "checking" | "master" | "agent" | "locked";
async function readRestoreSession(): Promise<RestoreSession> {
  const response = await chrome.runtime.sendMessage({ type: "getPasswordType" });
  if (!response || !["master", "agent", null].includes(response.passwordType)) throw new Error("Could not check wallet authorization. Retry.");
  return response.passwordType ?? "locked";
}

export function BunkerRestoreScreen({ onBack, onActivated, onCreate }: { onBack: () => void; onActivated: (accountId: string) => void; onCreate?: () => void }) {
  const [seed, setSeed] = useState(""), [address, setAddress] = useState(""), [hash, setHash] = useState("");
  const [session, setSession] = useState<RestoreSession>("checking");
  const [view, setView] = useState<BunkerAccountView | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const id = useRef(`bunker-draft:${crypto.randomUUID()}`), claim = useRef(false), alive = useRef(false), revision = useRef(0);
  useEffect(() => {
    alive.current = true;
    const generation = ++revision.current;
    void readRestoreSession().then(role => { if (alive.current && revision.current === generation) setSession(role); }).catch((e: Error) => { if (alive.current && revision.current === generation) setError(e.message); });
    const clear = (m: { type?: string }) => {
      if (m.type === "walletLockedExternal" || m.type === "walletLockFailedExternal") { revision.current++; setSeed(""); setSession("locked"); }
    };
    chrome.runtime.onMessage.addListener(clear);
    return () => { alive.current = false; revision.current = generation + 1; chrome.runtime.onMessage.removeListener(clear); };
  }, []);
  const submit = async () => {
    if (claim.current) return; claim.current = true; setBusy(true); setError("");
    const generation = revision.current;
    try {
      const role = await readRestoreSession();
      if (!alive.current || revision.current !== generation) return;
      if (role !== "master") { setSeed(""); setSession(role); return; }
      const result = view ? await bunkerCommand<{ view: BunkerAccountView }>({ type: "getSafeBunkerView", id: view.draftId }) :
        await bunkerCommand<{ view: BunkerAccountView }>({ type: "restoreSafeBunker", id: id.current, seed: seed.trim().toLowerCase().replace(/\s+/g, " "), address: address.trim().toLowerCase(), deploymentHash: hash.trim().toLowerCase() });
      if (!alive.current || revision.current !== generation) return;
      setSeed("");
      const restored = await completeBunkerRestore(result.view, {
        isCurrent: () => alive.current && revision.current === generation,
        authorize: async () => {
          const nextRole = await readRestoreSession();
          if (!alive.current || revision.current !== generation) return false;
          if (nextRole !== "master") { setSession(nextRole); return false; }
          return true;
        },
        continueRecovery: async (draftId) => (await bunkerCommand<{ view: BunkerAccountView }>({ type: "continueSafeBunkerRecovery", id: draftId })).view,
        onProgress: setView,
      });
      if (restored && alive.current && revision.current === generation) onActivated(restored.id);
    } catch (e) {
      if (alive.current && revision.current === generation) {
        setError(e instanceof Error ? e.message : "Recovery unavailable");
        // Expiry can occur during the RPC proof. Never retry across an unlock.
        const role = await readRestoreSession().catch(() => "checking" as const);
        if (alive.current && revision.current === generation && role !== "master") { setSeed(""); setSession(role); }
      }
    } finally { claim.current = false; if (alive.current) setBusy(false); }
  };
  if (session === "locked") return <VStack align="stretch" h="full" spacing={0}>
    {error && <Text role="alert" color="status.error.emphasis" fontSize="sm" p={4}>{error}</Text>}
    <UnlockScreen pendingTxCount={0} pendingSignatureCount={0} onUnlock={() => {
      void readRestoreSession().then(role => { if (alive.current) { setError(""); setSession(role); } }).catch((e: Error) => { if (alive.current) setError(e.message); });
    }} />
  </VStack>;
  if (busy && session === "master") return <AppScreen>
    <AppHeader title="Restore Bunker" onBack={onBack} />
    <ScreenBody display="flex" alignItems="center" justifyContent="center">
      <VStack role="status" aria-live="polite" aria-label="Restoring Bunker" spacing={4} px={4} textAlign="center">
        <Spinner size="xl" color="accent.highlight" thickness="3px" aria-hidden="true" />
        <Text fontSize="lg" fontWeight="600">Restoring your Bunker</Text>
        <Text fontSize="sm" color="fg.secondary">Checking your Safe and finding its current owner.</Text>
      </VStack>
    </ScreenBody>
  </AppScreen>;
  return <AppScreen><AppHeader title="Safe Bunker" onBack={onBack} /><ScreenBody pt={5}>{onCreate && !view && <BunkerSetupTabs mode="restore" onChange={onCreate} disabled={busy || !!view} />}<VStack align="stretch" spacing={4}>
    {session === "agent" ? <><Text fontSize="sm" color="fg.secondary">Unlock with your master password or biometrics to restore a Bunker.</Text><Button variant="brand" onClick={() => { setError(""); setSession("locked"); }}>Unlock wallet</Button></> : !view ? <>
      <FormControl><FormLabel htmlFor="bunker-recovery-phrase">Recovery phrase</FormLabel><Textarea id="bunker-recovery-phrase" value={seed} isDisabled={busy || session === "checking"} autoComplete="off" spellCheck={false} onChange={(e) => setSeed(e.target.value)} /></FormControl>
      <FormControl><FormLabel htmlFor="bunker-safe-address">Safe address</FormLabel><Input id="bunker-safe-address" value={address} isDisabled={busy} onChange={(e) => setAddress(e.target.value)} /></FormControl>
      <FormControl><FormLabel htmlFor="bunker-deployment-hash">Original deployment transaction</FormLabel><Input id="bunker-deployment-hash" value={hash} isDisabled={busy} onChange={(e) => setHash(e.target.value)} /></FormControl>
    </> : <VStack align="start" spacing={2}><Text fontWeight="600">Restore paused</Text><Text fontSize="sm" color="fg.secondary">Retry to pick up where you left off.</Text></VStack>}
    {error && <Text role="alert" fontSize="sm" color="status.error.emphasis">{error}</Text>}
    {session === "checking" && error && <Button variant="secondary" onClick={() => {
      const generation = revision.current;
      setError(""); void readRestoreSession().then(role => { if (alive.current && revision.current === generation) setSession(role); }).catch((e: Error) => { if (alive.current && revision.current === generation) setError(e.message); });
    }}>Retry authorization check</Button>}
  </VStack></ScreenBody>{session !== "agent" && <StickyActionBar primaryAction={<Button variant="brand" isLoading={busy || session === "checking" && !error} isDisabled={session !== "master" || !view && (!seed || !address || !hash)} onClick={() => void submit()}>{view ? "Retry restore" : "Restore"}</Button>} />}</AppScreen>;
}
