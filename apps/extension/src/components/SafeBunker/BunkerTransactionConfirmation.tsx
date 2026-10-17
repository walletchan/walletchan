import { BunkerRotationCalls, BunkerRotationPreview } from "./BunkerRotationReview";
import { CHAIN_REGISTRY } from "@/constants/chainRegistry";
import { RepeatIcon } from "@chakra-ui/icons";
import { isBunkerExecutionInFlight } from "@/chrome/safeBunker/requestPolicy";
import type { BunkerExecutionPhase } from "@/chrome/safeBunker/progress";
import { useEffect, useRef, useState } from "react";
import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { numberToHex } from "viem";
import type { Account, SafeBunkerAccount } from "@/chrome/types";
import type { BunkerAccountView, BunkerOperationSummary } from "@/chrome/safeBunker/types";
import type { GasOverrides } from "@/chrome/transactions/localExecution";
import { ConfirmationScreen } from "@/components/ui";
import { BatchCallsList } from "@/components/BatchCallsList";
import { CopyButton } from "@/components/CopyButton";
import { RequestIdentity } from "@/components/RequestConfirmation/RequestIdentity";
import { EstimatedChangesHeading } from "@/components/RequestConfirmation/EstimatedChangesHeading";
import { LedgerSigningStatus } from "@/components/Ledger/LedgerSigningStatus";
import { useIconChipBg, useStripTokens } from "@/theme";
import { QueueNavigation } from "@/components/RequestConfirmation/QueueNavigation";
import { earlierBunkerRequest, isUnsignedBunkerRequest } from "./requestQueue";
import { BunkerAssetPreview } from "./BunkerAssetPreview";
import { GasFeeLoading } from "@/components/GasEstimate/GasFeeLoading";
import { BunkerGasFields } from "./GasFields";
import { PayerFields } from "./PayerFields";
import { bunkerCommand } from "./transport";

/** Bunker execution adapter for the same confirmation composition used by imported Safes. */
export function BunkerTransactionConfirmation({ account, view, operation, onBack, onSubmitted, onReload, queue, onSelect, onRejected }: {
  account: SafeBunkerAccount; view: BunkerAccountView; operation: BunkerOperationSummary;
  queue: BunkerOperationSummary[]; onSelect: (id: string) => void; onRejected: (ids: string[]) => void;
  onBack: () => void; onSubmitted: () => void; onReload: () => Promise<void>;
}) {
  const { bg: stripBg, fg: stripFg } = useStripTokens();
  const earlier = earlierBunkerRequest(queue, operation);
  const index = queue.findIndex((item) => item.id === operation.id);
  const iconChipBg = useIconChipBg();
  // Keep only a deliberate override in state so refreshed persisted defaults hydrate.
  const [chosenPayer, setPayer] = useState<string | null>(null);
  const payer = chosenPayer ?? operation.payerId ?? view.defaultPayer?.id ?? "";
  const [payerAccount, setPayerAccount] = useState<Account | null>(null);
  const [remember, setRemember] = useState(false);
  const [gas, setGas] = useState<GasOverrides | null>(null);
  const [review, setReview] = useState<BunkerOperationSummary | null>(null);
  const [revision, setRevision] = useState(0);
  const [preparing, setPreparing] = useState(false);
  type Action = "confirm" | "reject" | "rejectAll" | "retry" | "status";
  const [action, setAction] = useState<Action | null>(null);
  const busy = action !== null, rejecting = action === "reject" || action === "rejectAll";
  const [phase, setPhase] = useState<BunkerExecutionPhase>("signing");
  const submittedOnce = useRef(false);
  const [error, setError] = useState("");
  const [previewValid, setPreviewValid] = useState(false);
  const [now, setNow] = useState(Date.now());
  const claim = useRef<Action | null>(null), alive = useRef(true);
  const unsigned = ["queued", "reviewed"].includes(operation.state);
  const retryable = ["signed", "pending", "ambiguous"].includes(operation.state);
  const submitted = !!operation.txHash;
  const waitingForExecution = operation.kind === "transaction" && !submitted && view.operations.some((op) => op.id !== operation.id && isBunkerExecutionInFlight(op));
  const canPrepare = !earlier && !waitingForExecution && (unsigned || retryable && !submitted);
  const origin = operation.origins[0] ?? "WalletChan";
  let hostname: string | null = null;
  try { hostname = new URL(origin).hostname; } catch { /* Internal wallet origin. */ }

  useEffect(() => { alive.current = true; const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { alive.current = false; clearInterval(timer); };
  }, []);
  useEffect(() => {
    let current = true;
    if (rejecting) { setPreparing(false); return; }
    setReview(null);
    if (!payer || !canPrepare) { setPreparing(false); return; }
    setPreparing(true);
    const timer = setTimeout(() => {
      void bunkerCommand<{ view: BunkerAccountView }>({ type: "reviewSafeBunkerRequest", accountId: account.id,
        requestId: operation.id, payerId: payer, gas }).then((response) => {
        if (current) {
          const prepared = response.view.operations.find((op) => op.id === operation.id) ?? null;
          if (operation.kind === "recovery" && !prepared?.rotation) throw new Error("Could not load owner rotation details. Retry the request.");
          setReview(prepared); setError("");
        }
      }).catch((caught: Error) => { if (current) setError(caught.message); })
        .finally(() => { if (current) setPreparing(false); });
    }, 250);
    return () => { current = false; clearTimeout(timer); };
  }, [account.id, operation.id, operation.kind, payer, gas, revision, canPrepare, rejecting]);

  const fresh = !!review?.reviewDigest && review.payerId === payer && (review.reviewExpiresAt ?? 0) > now;
  useEffect(() => {
    if (review?.reviewDigest && !fresh && !busy && !preparing && !error && canPrepare && !rejecting) {
      setReview(null); setRevision((v) => v + 1);
    }
  }, [review, fresh, busy, preparing, error, canPrepare, rejecting]);
  const rotation = fresh ? review?.rotation : undefined;
  const explorer = CHAIN_REGISTRY.find((chain) => chain.chainId === view.chainId)?.explorer;
  const blocked = !!earlier || !fresh || preparing || busy || operation.calls.length > 0 && !previewValid || !canPrepare;
  const run = async (work: () => Promise<void>, nextAction: Action = "status") => {
    if (claim.current) return;
    claim.current = nextAction; setAction(nextAction); setError("");
    try { await work(); }
    catch (caught) { if (alive.current) setError(caught instanceof Error ? caught.message : "Transaction unavailable"); }
    finally { claim.current = null; if (alive.current) setAction(null); }
  };
  const reject = (leave = false) => run(async () => {
    await bunkerCommand({ type: "rejectSafeBunkerRequest", accountId: account.id, requestId: operation.id });
    if (leave) onBack(); else onRejected([operation.id]);
  }, "reject");
  const back = () => {
    if (operation.kind === "recovery" && unsigned) void reject(true);
    else onBack();
  };
  const finishSubmission = () => {
    if (submittedOnce.current) return;
    submittedOnce.current = true; onSubmitted();
  };
  useEffect(() => {
    const listener = (message: { type?: string; accountId?: string; requestId?: string; phase?: string }, sender: chrome.runtime.MessageSender) => {
      if (sender.id !== chrome.runtime.id || sender.tab || claim.current !== "confirm" || message.type !== "safeBunkerExecutionProgress" || message.accountId !== account.id || message.requestId !== operation.id) return;
      if (!["signing", "checking", "broadcasting", "submitted"].includes(message.phase ?? "")) return;
      setPhase(message.phase as BunkerExecutionPhase);
      if (message.phase === "submitted") finishSubmission();
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  // Hints are correlated with this exact account/request; background authority is unchanged.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id, operation.id, onSubmitted]);
  const confirm = () => run(async () => {
    if (blocked || !review?.reviewDigest) return;
    setPhase("signing"); submittedOnce.current = false;
    const response = await bunkerCommand<{ view: BunkerAccountView }>({ type: "confirmSafeBunkerRequest",
      accountId: account.id, requestId: operation.id, digest: review.reviewDigest, remember });
    const result = response.view.operations.find((op) => op.id === operation.id);
    if (result?.txHash) finishSubmission();
    else { setReview(null); await onReload(); setRevision((v) => v + 1); }
  }, "confirm");

  return <ConfirmationScreen title={operation.kind === "recovery" ? "Rotate owner" : "Transaction request"}
    onBack={back} isBackDisabled={busy}
    navigation={<QueueNavigation currentIndex={index} totalCount={queue.length} stripBg={stripBg} stripFg={stripFg} isDisabled={busy}
      onNavigate={(direction) => { const next = queue[index + (direction === "next" ? 1 : -1)]; if (next) onSelect(next.id); }}
      onRejectAll={queue.every(isUnsignedBunkerRequest) ? () => void run(async () => {
        const rejected: string[] = [];
        try { for (const item of queue) { await bunkerCommand({ type: "rejectSafeBunkerRequest", accountId: account.id, requestId: item.id }); rejected.push(item.id); } }
        finally { if (rejected.length) onRejected(rejected); }
      }, "rejectAll") : undefined} />}
    trailing={<CopyButton label="Copy transaction JSON" value={JSON.stringify(operation.calls, null, 2)} />}
    outcome={<RequestIdentity origin={origin} originHostname={hostname} favicon={null} iconChipBg={iconChipBg}
      isInternalWalletChan={operation.kind === "recovery" || origin === "WalletChan"} labelOverride={operation.kind === "recovery" ? "Owner rotation" : undefined} originInitials="SAFE" />}
    financialImpactTitle={<EstimatedChangesHeading chainId={view.chainId} chainName={view.chainName} />}
    financialImpact={operation.calls.length ? <Box px={3} bg="surface.raised" border="1px solid" borderColor="border.subtle" borderRadius="lg">
      <BunkerAssetPreview chainId={view.chainId} chainName={view.chainName} key={operation.id} safe={view.safeAddress} operation={operation} onValidityChange={setPreviewValid} />
    </Box> : <BunkerRotationPreview chainId={view.chainId} rotation={rotation} explorer={explorer} loading={preparing} />}
    context={<VStack align="stretch" spacing={3}>
      {operation.calls.length > 0 && <BatchCallsList chainId={view.chainId} calls={operation.calls.map((call) => ({ to: call.to, value: numberToHex(BigInt(call.value)), data: call.data }))} />}
      {operation.kind === "recovery" && <BunkerRotationCalls chainId={view.chainId} rotation={rotation} explorer={explorer} />}
      {operation.origins.length > 1 && <Text color="fg.secondary" fontSize="sm">{operation.origins.join(", ")}</Text>}
      {operation.kind === "recovery" && view.operations.some((op) => op.id !== operation.id && ["signed", "pending", "ambiguous"].includes(op.state)) && <Text color="status.warning.emphasis" fontSize="sm">An earlier signed transaction can execute before rotation.</Text>}
      {operation.txHash && <Text fontSize="xs" fontFamily="mono" overflowWrap="anywhere">{operation.txHash}</Text>}
    </VStack>}
    actionSummary={<VStack align="stretch" spacing={2}>
      <PayerFields chainId={view.chainId} compact defaultAccountId={view.defaultPayer?.id} onAccountChange={setPayerAccount} value={payer} onChange={(id) => { setPayer(id); setGas(null); setReview(null); }} remember={remember} onRemember={setRemember} disabled={busy || !canPrepare} />
      {preparing && !rejecting && <GasFeeLoading />}
      {(gas ?? review?.gas) && <Box display={preparing && !rejecting ? "none" : undefined}>
        <BunkerGasFields symbol={view.nativeCurrencySymbol} compact key={`${operation.id}:${payer}`} value={(gas ?? review?.gas)!} onChange={(next) => { setGas(next); setReview(null); }} disabled={busy} />
      </Box>}
      <LedgerSigningStatus active={action === "confirm" && phase === "signing" && payerAccount?.type === "ledger"} />
      {waitingForExecution && <><Text role="status" fontSize="sm" color="fg.secondary">Waiting for the previous transaction to confirm.</Text>
        <Button size="sm" variant="secondary" isDisabled={busy} onClick={() => void run(async () => { await bunkerCommand({ type: "reconcileSafeBunker", id: account.bunkerId }); await onReload(); })}>Check status</Button></>}
      {earlier && <Button size="sm" variant="secondary" isDisabled={busy} onClick={() => onSelect(earlier.id)}>Review earlier request</Button>}
    </VStack>}
    actionNotice={(error || operation.error) ? <HStack align="center" spacing={3} minW={0}>
      <Text role="alert" color="status.error.emphasis" fontSize="sm" flex="1" minW={0} overflowWrap="anywhere">{error || operation.error}</Text>
      {!busy && !preparing && canPrepare && payer && !fresh && error && error !== "Gas payer has insufficient native balance" && <Button
        flexShrink={0} size="sm" variant="secondary" bg="surface.raisedHover" leftIcon={<RepeatIcon boxSize={3.5} />}
        onClick={() => { setError(""); setRevision((v) => v + 1); }}>Retry</Button>}
    </HStack> : undefined}
    confirmAction={submitted && retryable ? <Button variant="brand" isLoading={action === "retry"} onClick={() => void run(async () => {
      await bunkerCommand({ type: "retrySafeBunkerRequest", accountId: account.id, requestId: operation.id }); onSubmitted();
    }, "retry")}>Retry exact transaction</Button> : canPrepare || earlier || waitingForExecution ? <Button variant="brand" loadingText={action === "confirm" ? phase === "checking" ? "Checking…" : phase === "broadcasting" || phase === "submitted" ? "Broadcasting…" : "Signing…" : undefined} isLoading={action === "confirm" || preparing && !rejecting} isDisabled={blocked} onClick={() => void confirm()}>Confirm</Button>
      : <Button variant="secondary" onClick={back}>Back to wallet</Button>}
    rejectAction={unsigned ? <Button variant="secondary" isLoading={action === "reject"} loadingText="Rejecting…" isDisabled={busy} onClick={() => void reject()}>Reject</Button> : undefined}
  />;
}
