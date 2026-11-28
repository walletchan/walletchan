import { useEffect, useRef, useState } from "react";
import { Button, FormControl, FormLabel, Text, Textarea, VStack } from "@chakra-ui/react";
import type { SeedGroup } from "@/chrome/types";
import { AppHeader, AppScreen, ScreenBody, ScreenSection } from "@/components/ui";
import { bunkerCommand } from "./transport";
export function BunkerSourceSetup({ onBack, onSaved }: { onBack: () => void; onSaved: (group: SeedGroup, generated: boolean) => void }) {
  const [phrase, setPhrase] = useState(""), [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const mounted = useRef(true), claim = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const lock = (m: { type?: string }) => { if (m.type === "walletLockedExternal" || m.type === "walletLockFailedExternal") { setPhrase(""); mounted.current = false; } };
    chrome.runtime.onMessage.addListener(lock);
    return () => { mounted.current = false; chrome.runtime.onMessage.removeListener(lock); };
  }, []);
  const save = async (generate: boolean) => {
    if (claim.current) return; claim.current = true; setBusy(true); setError("");
    try {
      const result = await bunkerCommand<{ group: SeedGroup }>({ type: "saveSeedPhraseOnly", generate, mnemonic: generate ? "" : phrase });
      setPhrase(""); if (mounted.current) onSaved(result.group, generate);
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : "Could not save seed phrase"); }
    finally { claim.current = false; if (mounted.current) setBusy(false); }
  };
  return <AppScreen><AppHeader title="Set up a seed phrase" onBack={onBack} /><ScreenBody pt={5}>
    <ScreenSection><VStack align="stretch" spacing={4}>
      <Text fontSize="sm" color="fg.secondary">Use this phrase for Bunker accounts and any regular accounts you add later.</Text>
      {!importing ? <><Button variant="brand" isLoading={busy} onClick={() => void save(true)}>Create new seed phrase</Button>
        <Button variant="secondary" isDisabled={busy} onClick={() => setImporting(true)}>Import seed phrase</Button></> : <>
        <FormControl><FormLabel>Seed phrase</FormLabel><Textarea autoComplete="off" spellCheck={false} value={phrase} isDisabled={busy} onChange={e => setPhrase(e.target.value)} placeholder="Enter your 12 recovery words" /></FormControl>
        <Button variant="brand" isLoading={busy} isDisabled={!phrase.trim()} onClick={() => void save(false)}>Save and continue</Button>
      </>}
      {error && <Text role="alert" color="status.error.emphasis" fontSize="sm">{error}</Text>}
    </VStack></ScreenSection>
  </ScreenBody></AppScreen>;
}
