import { useCallback, useEffect, useRef, useState } from "react";
import type { Account, SafeBunkerAccount } from "@/chrome/types";
import { bunkerCommand } from "@/components/SafeBunker/transport";
import type { PendingBunkerRequest } from "@/chrome/safeBunker/pendingRequests";
import type { BunkerAccountView } from "@/chrome/safeBunker/types";
import { preloadBunkerRequest } from "@/app/bunkerRequestPreload";
import type { AppView } from "@/components/ScreenTransition";

export function useBunkerNavigation({ unlocked, accounts, setView, onSelectAccount, onActivity }: { unlocked: boolean; accounts: Account[]; setView: (view: AppView) => void; onSelectAccount: (account: Account) => Promise<void>; onActivity: () => void }) {
  const [pendingBunkerRequests, setPendingBunkerRequests] = useState<PendingBunkerRequest[]>([]);
  const [account, setAccount] = useState<SafeBunkerAccount | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [initialView, setInitialView] = useState<BunkerAccountView | null>(null);
  const [initialError, setInitialError] = useState("");
  const opening = useRef(0), liveAccounts = useRef(accounts); liveAccounts.current = accounts;
  const liveUnlock = useRef(unlocked); liveUnlock.current = unlocked;
  const pending = useRef<string | null>(null), checked = useRef(false);
  const open = useCallback(async (next: Account | null, nextRequestId: string | null = "__pending__") => {
    if (next?.type !== "safeBunker") return;
    const revision = ++opening.current;
    if (!unlocked) { setView("unlock"); return; }
    let snapshot: BunkerAccountView | null = null, error = "";
    try { snapshot = await preloadBunkerRequest(next); }
    catch (cause) { error = cause instanceof Error ? cause.message : "Could not load Bunker request"; }
    const current = liveAccounts.current.find(a => a.id === next.id);
    if (!liveUnlock.current || opening.current !== revision || current?.type !== "safeBunker" ||
        current.bunkerId !== next.bunkerId || current.chainId !== next.chainId || current.seedGroupId !== next.seedGroupId ||
        current.address.toLowerCase() !== next.address.toLowerCase()) return;
    setInitialView(snapshot); setInitialError(error); setRequestId(nextRequestId); setAccount(current); setView("safeBunker");
  }, [setView, unlocked]);
  useEffect(() => {
    const lifecycle = opening;
    if (!unlocked) { ++lifecycle.current; setInitialView(null); setInitialError(""); setAccount(null); }
    return () => { ++lifecycle.current; };
  }, [unlocked]);
  const refreshPending = useCallback(async () => {
    if (!unlocked || !accounts.some((a) => a.type === "safeBunker")) { setPendingBunkerRequests([]); return []; }
    const result = await bunkerCommand<{ requests: PendingBunkerRequest[] }>({ type: "getPendingSafeBunkerRequests" });
    if (!liveUnlock.current) return [];
    setPendingBunkerRequests(result.requests); return result.requests;
  }, [unlocked, accounts]);
  const openPendingBunker = (id?: string) => {
    const request = pendingBunkerRequests.find((r) => r.id === id) ?? pendingBunkerRequests[0];
    if (request) open(accounts.find((a) => a.id === request.accountId) ?? null, request.id);
  };
  useEffect(() => {
    let active = true;
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (active && area === "local" && (changes.safeBunkerInboxV1 || changes.safeBunkerPendingV1)) void refreshPending().catch(() => {});
    };
    chrome.storage.onChanged.addListener(changed);
    void refreshPending().catch(() => {});
    return () => { active = false; chrome.storage.onChanged.removeListener(changed); };
  }, [refreshPending]);
  useEffect(() => {
    const listener = (message: { type?: string; requestId?: string }) => {
      if (message.type !== "newSafeBunkerRequest" || !message.requestId) return;
      pending.current = message.requestId;
      if (!unlocked) { setView("unlock"); return; }
      void bunkerCommand<{ account: Account | null }>({ type: "getSafeBunkerRequestAccount", requestId: message.requestId }).then((r) => open(r.account, message.requestId)).catch(() => {});
    };
    chrome.runtime.onMessage.addListener(listener);
    if (!unlocked) checked.current = false;
    if (unlocked && accounts.length && !checked.current) {
      checked.current = true;
      const requested = pending.current;
      void bunkerCommand<{ account: Account | null }>(pending.current
        ? { type: "getSafeBunkerRequestAccount", requestId: pending.current }
        : { type: "getPendingSafeBunkerAccount" }).then((r) => { pending.current = null; open(r.account, requested ?? "__pending__"); }).catch(() => {});
    }
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [unlocked, accounts.length, open, setView]);
  const handleBunkerSubmitted = (next: Account) => {
    // Account selection owns address/chain state just as it does for ordinary Home navigation.
    void onSelectAccount(next).then(onActivity).catch(onActivity);
  };
  return { bunkerRequestAccount: account, bunkerRequestId: requestId, bunkerInitialView: initialView, bunkerInitialError: initialError, pendingBunkerRequests, openPendingBunker, openBunker: open, handleBunkerSubmitted };
}
