import { BunkerDeploymentScreen } from "./BunkerDeploymentScreen";
import { BunkerRestoreScreen } from "./BunkerRestoreScreen";
import { useEffect, useRef, useState } from "react";
import { Button, FormControl, FormLabel, Input, Text, VStack } from "@chakra-ui/react";
import { AppHeader, AppScreen, ScreenBody, ScreenSection, StickyActionBar } from "@/components/ui";
import { BunkerSetupIntro } from "./BunkerSetupIntro";
import { BunkerSetupTabs } from "./BunkerSetupTabs";
import { sendDraftCommand } from "./client";

export function SafeBunkerDraftScreen({ onBack, onActivated = onBack }: { onBack: () => void; onActivated?: (accountId: string) => void }) {
  const [intro, setIntro] = useState(true);
  const [deploymentId, setDeploymentId] = useState<string | null>(null);
  const [restore, setRestore] = useState(false);
  const [name, setName] = useState("SafeBunker");
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const [saving, setSaving] = useState(false);
  const alive = useRef(false);
  const revision = useRef(0);
  const busy = useRef(false);
  const completedSetup = useRef<{ id: string; name: string } | null>(null);
  const creation = useRef<{ id: string; name: string } | null>(null);
  useEffect(() => {
    alive.current = true;
    ++revision.current;
    const invalidate = (message: { type?: string }) => {
      if (message.type === "walletLockedExternal" || message.type === "walletLockFailedExternal") {
        revision.current++; setDeploymentId(null); setName("");
        setError("Wallet locked. Reopen setup after unlocking."); setUnavailable(true);
      }
    };
    chrome.runtime.onMessage.addListener(invalidate);
    return () => { alive.current = false; revision.current++; chrome.runtime.onMessage.removeListener(invalidate); };
  }, []);

  const create = async () => {
    if (busy.current || unavailable || !name.trim()) return;
    if (completedSetup.current?.name === name.trim()) { setDeploymentId(completedSetup.current.id); return; }
    busy.current = true; setSaving(true); setError("");
    const generation = revision.current;
    // Retain the same ID and exact inputs after uncertain responses.
    creation.current ??= { id: `bunker-draft:${crypto.randomUUID()}`, name: name.trim() };
    try {
      const result = await sendDraftCommand({ type: "createSafeBunkerDraft", ...creation.current });
      if (!result.draft || result.draft.id !== creation.current.id || result.draft.name !== creation.current.name)
        throw new Error("Setup response did not match this request. Reopen setup to check.");
      if (alive.current && revision.current === generation) {
        const draft = result.draft;
        completedSetup.current = { id: draft.id, name: draft.name };
        setDeploymentId(draft.id); creation.current = null;
      }
    } catch (e) {
      if (alive.current && revision.current === generation) setError(e instanceof Error ? e.message : "Could not create Bunker");
    } finally {
      busy.current = false;
      if (alive.current && revision.current === generation) setSaving(false);
    }
  };
  if (intro) return <BunkerSetupIntro onBack={onBack} onProceed={() => setIntro(false)} />;
  if (deploymentId) return <BunkerDeploymentScreen id={deploymentId} onBack={() => setDeploymentId(null)} onActivated={onActivated} />;
  if (restore) return <BunkerRestoreScreen onBack={() => setIntro(true)} onCreate={() => setRestore(false)} onActivated={onActivated} />;
  return <AppScreen>
    <AppHeader title="Safe Bunker" onBack={() => setIntro(true)} />
    <ScreenBody pt={5}>
      <BunkerSetupTabs mode="create" onChange={() => setRestore(true)} disabled={saving} />
      <VStack align="stretch" spacing={5}>
        <ScreenSection>
          <FormControl isRequired>
            <FormLabel htmlFor="bunker-name">Name</FormLabel>
            <Input id="bunker-name" value={name} maxLength={64} isDisabled={unavailable || saving || !!creation.current}
              placeholder="My Bunker" onChange={(e) => setName(e.target.value)} />
          </FormControl>
        </ScreenSection>
        {error && <Text role="alert" color="status.error.emphasis" fontSize="sm">{error}</Text>}

      </VStack>
    </ScreenBody>
    <StickyActionBar primaryAction={<Button variant="brand" onClick={() => void create()}
      isLoading={saving} loadingText="Creating…" isDisabled={unavailable || !name.trim()}>
      {creation.current ? "Retry" : "Continue"}
    </Button>} />
  </AppScreen>;
}
