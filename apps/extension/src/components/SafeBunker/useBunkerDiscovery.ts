import { useCallback, useEffect, useRef, useState } from "react";
import type { Account, SeedGroup } from "@/chrome/types";
import type { BunkerDiscoveryResult } from "@/chrome/safeBunker/discovery";
import { bunkerCommand } from "./transport";
export interface BunkerNetwork { chainId: number; name: string; icon: string; explorer: string; nativeCurrency: { symbol: string; decimals: number; name: string } }
export type { DiscoveryRow } from "./discoveryModel";
import { localBunkerDiscoveryRows, mergeDiscoveryRow, type DiscoveryRow } from "./discoveryModel";
export function useBunkerDiscovery(seedGroupId?: string) {
  const [groups, setGroups] = useState<SeedGroup[]>([]), [networks, setNetworks] = useState<BunkerNetwork[]>([]);
  const [localResults, setLocalResults] = useState<Record<string, Record<number, DiscoveryRow>>>({});
  const [results, setResults] = useState<Record<string, Record<number, DiscoveryRow>>>({});
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const epoch = useRef(0), scanning = useRef(false);
  const [checking, setChecking] = useState(false), [searched, setSearched] = useState(false);
  const refresh = useCallback(() => setRevision(n => n + 1), []);
  useEffect(() => {
    const lifecycle = epoch;
    const generation = ++lifecycle.current;
    let cancelled = false;
    const active = () => !cancelled && generation === epoch.current;
    scanning.current = false; setChecking(false); setSearched(false);
    setLoading(true); setError("");
    const load = async () => {
      try {
        const [saved, response, accounts] = await Promise.all([
          chrome.runtime.sendMessage({ type: "getSeedGroups" }),
          bunkerCommand<{ networks: BunkerNetwork[] }>({ type: "getSafeBunkerNetworks" }),
          chrome.runtime.sendMessage({ type: "getAccounts" }),
        ]);
        if (!active()) return;
        if (!Array.isArray(saved)) throw new Error("Could not load saved seed phrases");
        if (!Array.isArray(accounts)) throw new Error("Could not load saved Bunker accounts");
        setGroups(saved); setNetworks(response.networks);
        const local = localBunkerDiscoveryRows(accounts as Account[]);
        setLocalResults(local);
        setResults(old => {
          const next = { ...old };
          for (const [id, rows] of Object.entries(local)) next[id] = { ...next[id], ...rows };
          return next;
        });
      } catch (cause) { if (active()) setError(cause instanceof Error ? cause.message : "Could not load Bunkers"); }
      finally { if (active()) setLoading(false); }
    };
    const onLock = (message: { type?: string }) => {
      if (["walletLockedExternal", "walletLockFailedExternal"].includes(message.type ?? "")) {
        cancelled = true; ++epoch.current; scanning.current = false; setChecking(false); setSearched(false); setLocalResults({}); setResults({}); setLoading(false); setError("Unlock the wallet to check Bunkers.");
      }
    };
    chrome.runtime.onMessage.addListener(onLock);
    void load();
    return () => { cancelled = true; ++lifecycle.current; chrome.runtime.onMessage.removeListener(onLock); };
  }, [revision, seedGroupId]);
  const find = useCallback(async () => {
    if (!seedGroupId || loading || scanning.current || networks.length === 0) return;
    const generation = epoch.current;
    const active = () => generation === epoch.current;
    scanning.current = true; setChecking(true); setSearched(false); setError("");
    const jobs = networks;
    let cursor = 0;
    const worker = async () => {
      while (active() && cursor < jobs.length) {
        const network = jobs[cursor++];
        const publish = (row: DiscoveryRow) => { if (active()) setResults(old => ({ ...old, [seedGroupId]: { ...old[seedGroupId], [network.chainId]: mergeDiscoveryRow(old[seedGroupId]?.[network.chainId], row) } })); };
        publish({ chainId: network.chainId, status: "checking" });
        try {
          let result: BunkerDiscoveryResult;
          do {
            const response = await bunkerCommand<{ discovery: BunkerDiscoveryResult }>({ type: "discoverSafeBunker", seedGroupId, chainId: network.chainId });
            result = response.discovery;
            if (!active()) return;
            publish(result);
            if (result.status === "searching") await new Promise(resolve => setTimeout(resolve, 20));
          } while (active() && result.status === "searching");
        } catch {
          publish({ chainId: network.chainId, status: "error", error: "Could not verify this network. Retry to check again." });
        }
      }
    };
    try { await Promise.all([worker(), worker(), worker()]); }
    finally { if (active()) { scanning.current = false; setChecking(false); setSearched(true); } }
  }, [seedGroupId, loading, networks]);
  return { groups, networks, localResults, results, loading, checking, searched, error, refresh, find };
}
