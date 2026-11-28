import { useLayoutEffect, useRef, useState } from "react";
import { CheckIcon, ChevronRightIcon, DeleteIcon, RepeatIcon, ViewIcon } from "@chakra-ui/icons";
import { Box, Button, FormControl, HStack, Input, Skeleton, Text, VStack } from "@chakra-ui/react";
import type { Account, SafeBunkerAccount } from "@/chrome/types";
import { isBunkerApprovalPending, isBunkerExecutionInFlight } from "@/chrome/safeBunker/requestPolicy";
import { AppHeader, AppScreen, ListItem, ListItemActions, ListItemContent, ListItemDescription, ListItemMedia, ListItemTitle, ListSurface, ScreenBody, ScreenSection } from "@/components/ui";
import { useScreenScrollRestoration } from "@/components/useScreenScrollRestoration";
import { AccountRemovalModal } from "@/components/AccountRemovalModal";
import type { AccountRemovalStep } from "@/components/accountRemovalModel";
import AccountSettingsIdentity from "@/components/AccountSettingsIdentity";
import RevealSeedPhrase from "@/components/RevealSeedPhrase";
import { ShieldIcon } from "@/components/Settings/icons";
import { CHAIN_REGISTRY } from "@/constants/chainRegistry";
import { BunkerDeploymentScreen } from "./BunkerDeploymentScreen";
import { BunkerAccountScreen } from "./BunkerAccountScreen";
import { BunkerRotationScreen } from "./BunkerRotationScreen";
import { bunkerCommand } from "./transport";
import { useBunkerSettings } from "./useBunkerSettings";

type Destination = "deployment" | "settings" | "phrase" | "recover";
export function BunkerSettingsScreen({ account, accounts, onBack, onAccountUpdated, onSubmitted, initialScreen = "settings" }: {
  initialScreen?: "settings" | "recover";
  account: SafeBunkerAccount; accounts: Account[]; onBack: () => void;
  onAccountUpdated: () => void | Promise<unknown>; onSubmitted: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const scrollTop = useRef(0);
  const { restore: restoreScroll, cancel: cancelScrollRestore } = useScreenScrollRestoration(container);
  const [screen, setScreen] = useState<Destination>(initialScreen);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [deleteStep, setDeleteStep] = useState<AccountRemovalStep>("review");
  const [recoveryId, setRecoveryId] = useState<string | null>(null);
  const { view, busy, error, setError, role, name, savedName, setName, saveName, refresh, run, load } = useBunkerSettings(account, onAccountUpdated);
  const chain = CHAIN_REGISTRY.find((item) => item.chainId === account.chainId);
  const displayAccount = { ...account, displayName: savedName || undefined };
  const back = () => { if (!busy) { setError(""); setScreen("settings"); } };
  const navigate = (next: Destination) => {
    cancelScrollRestore();
    scrollTop.current = container.current?.querySelector<HTMLElement>("[data-screen-scroll-owner]")?.scrollTop ?? 0;
    setError(""); setScreen(next);
  };
  useLayoutEffect(() => {
    if (screen === "settings" && !recoveryId) restoreScroll(scrollTop.current);
  }, [screen, recoveryId, restoreScroll]);
  const masterOnly = role !== "master";
  const unresolved = view?.operations.some((op) => isBunkerApprovalPending(op) || isBunkerExecutionInFlight(op));
  const removeBlocked = accounts.length <= 1 ? "You cannot remove your last account." : unresolved ? "Resolve pending Bunker requests and submitted transactions before removing this account." : undefined;
  const recover = () => void run("recover", async () => {
    if (masterOnly) throw new Error("Unlock with your master password");
    let next = view;
    if (view?.recovering) {
      await bunkerCommand({ type: "continueSafeBunkerRecovery", id: account.bunkerId });
      next = await load();
      if (next.recovering) return;
    }
    const existing = next?.operations.find((op) => op.kind === "recovery" && isBunkerApprovalPending(op));
    if (existing) { setRecoveryId(existing.id); return; }
    const response = await bunkerCommand<{ result: { id?: string; scanning?: boolean } }>({ type: "createSafeBunkerRecovery", accountId: account.id });
    await load();
    if (response.result.id) setRecoveryId(response.result.id);
  });
  if (screen === "deployment") return <BunkerDeploymentScreen id={account.bunkerId} onBack={back} onActivated={onSubmitted} />;
  if (recoveryId) return <BunkerAccountScreen rejectOnBack account={account} initialRequestId={recoveryId} onBack={() => { setRecoveryId(null); void load().catch(() => {}); }} onSubmitted={onSubmitted} />;
  if (screen === "phrase") return <RevealSeedPhrase account={null} seedGroupIdOverride={account.seedGroupId} onBack={back} />;
  if (view && screen === "recover") return <BunkerRotationScreen account={displayAccount} view={view} busy={!!busy} error={error} onBack={back} onRecover={recover} canRotate={!masterOnly} />;
  const closeRemoval = () => { if (!busy) { setIsDeleteOpen(false); setDeleteStep("review"); setError(""); } };
  const remove = () => {
    if (deleteStep !== "final" || masterOnly || !view || removeBlocked) return;
    void run("remove", async () => {
      await bunkerCommand({ type: "removeSafeBunker", accountId: account.id, backedUp: true });
      await onAccountUpdated(); onBack();
    });
  };
  return <><AppScreen ref={container}><AppHeader title="Account settings" onBack={onBack} isBackDisabled={!!busy} />
    <ScreenBody pt={5}><VStack align="stretch" spacing={6}>
      <Box pb={5} borderBottom="1px solid" borderColor="border.subtle">
        <AccountSettingsIdentity account={displayAccount} resolvedName={null} resolvedAvatar={null} explorerUrl={chain ? `${chain.explorer}/address/${account.address}` : undefined} />
      </Box>
      <ScreenSection title="Account name" description="Shown throughout WalletChan.">
        <FormControl><HStack spacing={2}><Input aria-label="Display name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Enter a name" onKeyDown={(e) => { if (e.key === "Enter" && name.trim() !== savedName && !busy) void saveName(); }} />
          {name.trim() !== savedName && <Button variant="brand" minW="76px" leftIcon={<CheckIcon />} isLoading={busy === "name"} isDisabled={!!busy} onClick={() => void saveName()}>Save</Button>}
        </HStack></FormControl>
      </ScreenSection>
      <ScreenSection title="Bunker details"><ListSurface>
        <ListItem density="compact"><ListItemContent><ListItemTitle>Network</ListItemTitle></ListItemContent><Text fontSize="sm" color="fg.secondary">{chain?.name ?? `Chain ${account.chainId}`}</Text></ListItem>
        <ListItem density="compact"><ListItemContent><ListItemTitle>Last verified owner</ListItemTitle><ListItemDescription>Index in your recovery phrase</ListItemDescription></ListItemContent>
          {view ? <Text fontSize="sm" fontFamily="mono" color="fg.secondary">{view.ownerIndex === undefined ? "Unavailable" : `#${view.ownerIndex}`}</Text> : <Skeleton w="40px" h="16px" />}
        </ListItem>
        {view && (view.recovering || view.exposureUnknown) && <ListItem density="compact"><ListItemContent><ListItemTitle>Recovery status</ListItemTitle><ListItemDescription>{view.recovering ? "Owner scan in progress" : "Owner recovery required before sending"}</ListItemDescription></ListItemContent></ListItem>}
      </ListSurface></ScreenSection>
      {error && <HStack align="start" spacing={3}><Text role="alert" flex={1} minW={0} fontSize="sm" color="status.error.emphasis" overflowWrap="anywhere">{error}</Text>
        <Button variant="secondary" size="sm" flexShrink={0} leftIcon={<RepeatIcon />} isLoading={busy === "load"} isDisabled={!!busy} onClick={() => void run("load", async () => { if (view) await bunkerCommand({ type: "reconcileSafeBunker", id: account.bunkerId }); await load(); })}>Retry</Button></HStack>}
      <ScreenSection title="Account tools"><ListSurface>
        {account.deploymentPending && <ListItem interactive isDisabled={masterOnly || !!busy} onClick={() => navigate("deployment")}><ListItemContent><ListItemTitle>View deployment</ListItemTitle><ListItemDescription>Check confirmation or retry the submitted deployment</ListItemDescription></ListItemContent><ListItemActions><ChevronRightIcon boxSize={5} /></ListItemActions></ListItem>}
        <ListItem interactive isDisabled={!!busy} onClick={() => void refresh()}><ListItemMedia><RepeatIcon boxSize={5} /></ListItemMedia><ListItemContent><ListItemTitle>{busy === "refresh" ? "Refreshing Bunker details…" : "Refresh Bunker details"}</ListItemTitle></ListItemContent></ListItem>
      </ListSurface></ScreenSection>
      <ScreenSection title="Recovery"><ListSurface>
        <ListItem interactive isDisabled={masterOnly} onClick={() => navigate("phrase")}><ListItemMedia><ViewIcon boxSize={5} /></ListItemMedia><ListItemContent><ListItemTitle>Reveal recovery phrase</ListItemTitle><ListItemDescription>{masterOnly ? "Unlock with your master password" : "View your 12 recovery words"}</ListItemDescription></ListItemContent><ListItemActions><ChevronRightIcon boxSize={5} /></ListItemActions></ListItem>
        <ListItem interactive isDisabled={masterOnly || !view || !view.deployed} onClick={() => navigate("recover")}><ListItemMedia><ShieldIcon boxSize={5} /></ListItemMedia><ListItemContent><ListItemTitle>Rotate owner</ListItemTitle><ListItemDescription>{masterOnly ? "Unlock with your master password" : view?.recovering ? "Continue discovering your signing owner" : "Switch to the next owner from your recovery phrase"}</ListItemDescription></ListItemContent><ListItemActions><ChevronRightIcon boxSize={5} /></ListItemActions></ListItem>
      </ListSurface></ScreenSection>
      <ScreenSection title="Sensitive actions"><ListSurface><ListItem interactive isDisabled={masterOnly || !view || !!removeBlocked} onClick={() => { setDeleteStep("review"); setError(""); setIsDeleteOpen(true); }}>
        <ListItemMedia><DeleteIcon boxSize={5} color="status.error.emphasis" /></ListItemMedia><ListItemContent><ListItemTitle color="status.error.emphasis">Remove account</ListItemTitle>{(masterOnly || removeBlocked) && <ListItemDescription>{masterOnly ? "Unlock with your master password" : removeBlocked}</ListItemDescription>}</ListItemContent><ListItemActions><ChevronRightIcon boxSize={5} /></ListItemActions>
      </ListItem></ListSurface></ScreenSection>
    </VStack></ScreenBody>
  </AppScreen><AccountRemovalModal account={displayAccount} accounts={accounts} isOpen={isDeleteOpen}
    isDeleting={busy === "remove"} deleteStep={deleteStep} onStepChange={setDeleteStep} onClose={closeRemoval}
    onConfirm={remove} error={error} disabledReason={masterOnly ? "Unlock with your master password" : removeBlocked} /></>;
}
