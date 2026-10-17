import { useCallback, useEffect, useRef, useState } from "react";
import type { PasswordType, SafeBunkerAccount } from "@/chrome/types";
import type { BunkerAccountView } from "@/chrome/safeBunker/types";
import { useThemedToast } from "@/hooks/useThemedToast";
import { bunkerCommand } from "./transport";

/** Settings read public journal projections; mutations stay in their existing background owners. */
export function useBunkerSettings(account: SafeBunkerAccount, onAccountUpdated: () => void | Promise<unknown>) {
  const [view, setView] = useState<BunkerAccountView | null>(null);
  const [role, setRole] = useState<PasswordType | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [name, setName] = useState(account.displayName || "");
  const [savedName, setSavedName] = useState(account.displayName || "");
  const alive = useRef(false), claim = useRef(false), read = useRef(0);
  const toast = useThemedToast();
  const load = useCallback(async () => {
    const revision = ++read.current;
    const result = await bunkerCommand<{ view: BunkerAccountView }>({ type: "getSafeBunkerView", id: account.seedVaultId });
    if (alive.current && revision === read.current) setView(result.view);
    return result.view;
  }, [account.seedVaultId]);
  useEffect(() => {
    alive.current = true;
    void load().catch((e: Error) => { if (alive.current) setError(e.message); });
    void chrome.runtime.sendMessage({ type: "getPasswordType" }).then((result) => {
      if (alive.current) setRole(result?.passwordType ?? null);
    }).catch(() => {});
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && changes.safeBunkerStateV1) void load().catch(() => {});
    };
    chrome.storage.onChanged.addListener(changed);
    return () => { alive.current = false; chrome.storage.onChanged.removeListener(changed); };
  }, [load]);
  const run = async (action: string, work: () => Promise<void>) => {
    if (claim.current) return;
    claim.current = true; setBusy(action); setError("");
    try { await work(); }
    catch (e) {
      if (alive.current) {
        const message = e instanceof Error ? e.message : "Could not complete this action. Try again.";
        setError(action === "remove" && message === "Confirm seed backup and master password" ? "Incorrect master password. Try again." : message);
      }
    }
    finally { claim.current = false; if (alive.current) setBusy(null); }
  };
  const saveName = () => run("name", async () => {
    const trimmed = name.trim();
    const result = await chrome.runtime.sendMessage({ type: "updateAccountDisplayName", accountId: account.id, displayName: trimmed || undefined });
    if (!result?.success) throw new Error(result?.error || "Could not save account name.");
    if (!alive.current) return;
    setName(trimmed); setSavedName(trimmed);
    toast({ title: "Display name updated", status: "success", duration: 2000 });
    await onAccountUpdated();
  });
  const refresh = () => run("refresh", async () => {
    await bunkerCommand({ type: "reconcileSafeBunker", id: account.seedVaultId });
    await load();
    if (alive.current) toast({ title: "Bunker details refreshed", status: "success", duration: 2000 });
  });
  return { view, role, busy, error, setError, name, setName, savedName, saveName, refresh, load, run };
}
