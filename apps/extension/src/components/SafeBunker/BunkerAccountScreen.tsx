import { isBunkerExecutionInFlight } from "@/chrome/safeBunker/requestPolicy";
import { useEffect, useRef, useState } from "react";
import { Button, Text } from "@chakra-ui/react";
import type { SafeBunkerAccount } from "@/chrome/types";
import type { BunkerAccountView } from "@/chrome/safeBunker/types";
import { AppHeader, AppScreen, ScreenBody } from "@/components/ui";
import InitialRequestLoadingScreen from "@/app/screens/InitialRequestLoadingScreen";
import { bunkerCommand } from "./transport";
import { isPendingBunkerRequest, selectBunkerRequest } from "./requestQueue";
import { BunkerTransactionConfirmation } from "./BunkerTransactionConfirmation";

export function BunkerAccountScreen({ account, initialRequestId, initialView, initialError = "", onBack, onSubmitted, rejectOnBack = false }: { rejectOnBack?: boolean; account: SafeBunkerAccount; initialRequestId?: string | null; initialView?: BunkerAccountView | null; initialError?: string; onBack: () => void; onSubmitted: () => void }) {
  const seedView = initialView?.id === account.id && initialView.draftId === account.bunkerId &&
    initialView.chainId === account.chainId && initialView.seedGroupId === account.seedGroupId &&
    initialView.safeAddress.toLowerCase() === account.address.toLowerCase() ? initialView : null;
  const [view, setView] = useState<BunkerAccountView | null>(seedView);
  const [requestId, setRequestId] = useState<string | null>(initialRequestId ?? null);
  const [automatic, setAutomatic] = useState(true);
  const [busy, setBusy] = useState(false), [error, setError] = useState(initialError);
  const rejectedIds = useRef(new Set<string>());
  const alive = useRef(false), claim = useRef(false), generation = useRef(0), reads = useRef(0);
  const previousRequestId = useRef(initialRequestId);
  const refresh = async () => {
    const read = ++reads.current, revision = generation.current;
    const r = await bunkerCommand<{ view: BunkerAccountView }>({ type: "getSafeBunkerView", id: account.bunkerId });
    if (!alive.current || read !== reads.current || revision !== generation.current) return;
    r.view.operations = r.view.operations.map((op) => rejectedIds.current.has(op.id) ? { ...op, state: "rejected" } : op);
    setView(r.view); return r.view;
  };
  const run = async (work: () => Promise<unknown>) => {
    if (claim.current) return; claim.current = true; setBusy(true); setError("");
    const revision = generation.current;
    try { await work(); if (alive.current && generation.current === revision) await refresh(); }
    catch (e) { if (alive.current && generation.current === revision) setError(e instanceof Error ? e.message : "Operation unavailable"); }
    finally { claim.current = false; if (alive.current && generation.current === revision) setBusy(false); }
  };
  useEffect(() => { alive.current = true; const revision = ++generation.current;
    if (!seedView && !initialError) void refresh().catch((e: Error) => { if (alive.current) setError(e.message); });
    const timer = setInterval(() => { if (!claim.current) void refresh().catch(() => {}); }, 15000);
    return () => { alive.current = false; generation.current = revision + 1; clearInterval(timer); };
  // Account ID changes remount the feature surface.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id]);
  useEffect(() => {
    setRequestId(initialRequestId ?? null); setAutomatic(true);
    if (initialRequestId && previousRequestId.current !== initialRequestId) void refresh().catch(() => {});
    previousRequestId.current = initialRequestId;
  // Refresh newly received requests even when this account surface is already open.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRequestId]);
  const pending = view?.operations.filter(isPendingBunkerRequest) ?? [];
  const submitted = view?.operations.filter(isBunkerExecutionInFlight) ?? [];
  const operation = selectBunkerRequest(pending, requestId, automatic) ?? (!automatic ? submitted.find((op) => op.id === requestId) : undefined);
  const advance = (ids: string[]) => {
    for (const id of ids) rejectedIds.current.add(id);
    setView((previous) => previous ? { ...previous, operations: previous.operations.map((op) => rejectedIds.current.has(op.id) ? { ...op, state: "rejected" } : op) } : previous);
    if (!pending.some((op) => !rejectedIds.current.has(op.id))) onBack();
    else { setAutomatic(true); setRequestId("__pending__"); }
  };
  const leaveLoading = () => {
    if (rejectOnBack && initialRequestId) void run(async () => {
      await bunkerCommand({ type: "rejectSafeBunkerRequest", accountId: account.id, requestId: initialRequestId });
      onBack();
    });
    else onBack();
  };
  const loadingTitle = rejectOnBack ? "Rotate owner" : "Transaction request";
  if (initialRequestId && (!view || rejectOnBack && (busy || !!error))) return error ? <AppScreen><AppHeader title={loadingTitle} onBack={leaveLoading} isBackDisabled={busy} /><ScreenBody>
    <Text role="alert" color="status.error.emphasis">{error}</Text><Button variant="secondary" isDisabled={busy} onClick={() => void run(refresh)}>Retry</Button>
  </ScreenBody></AppScreen> : <InitialRequestLoadingScreen title={loadingTitle} onBack={leaveLoading} />;
  if (view && operation) return <BunkerTransactionConfirmation key={operation.id} account={account} view={view} operation={operation}
    queue={operation.txHash ? [operation] : pending} onSelect={(id) => { setAutomatic(false); setRequestId(id); }} onRejected={advance}
    onBack={onBack} onSubmitted={onSubmitted} onReload={async () => { await refresh(); }} />;
  return <AppScreen><AppHeader title="Transaction request" onBack={onBack} />
    <ScreenBody pt={5}><Text color="fg.secondary">This request no longer needs approval.</Text>
      <Button mt={4} variant="secondary" onClick={onBack}>Go back</Button>
    </ScreenBody></AppScreen>;
}
