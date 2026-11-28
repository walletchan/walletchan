import { useEffect, useRef, useState } from "react";
import type { SeedGroup } from "@/chrome/types";

export interface RestoredBunkerSelection { accountId: string; chainId: number }
export class BunkerOnboardingCancelled extends Error {
  constructor() { super("Bunker import cancelled"); }
}

/** Pause the existing setup transaction while the user selects verified deployments. */
export function useBunkerOnboardingSelection() {
  const [group, setGroup] = useState<SeedGroup | null>(null);
  const alive = useRef(true), generation = useRef(0);
  const pending = useRef<{ resolve: (selection: RestoredBunkerSelection) => void; reject: (error: Error) => void } | null>(null);
  const cancel = () => { ++generation.current; pending.current?.reject(new BunkerOnboardingCancelled()); pending.current = null; setGroup(null); };
  useEffect(() => {
    alive.current = true; const lifecycle = generation;
    const locked = (message: { type?: string }) => {
      if (message.type === "walletLockedExternal" || message.type === "walletLockFailedExternal") cancel();
    };
    chrome.runtime.onMessage.addListener(locked);
    return () => { alive.current = false; ++lifecycle.current; chrome.runtime.onMessage.removeListener(locked); pending.current?.reject(new BunkerOnboardingCancelled()); pending.current = null; };
  }, []);
  return { group, cancel,
    request: () => {
      const revision = ++generation.current;
      return (source: SeedGroup) => new Promise<RestoredBunkerSelection>((resolve, reject) => {
        if (!alive.current || revision !== generation.current) { reject(new BunkerOnboardingCancelled()); return; }
        pending.current = { resolve, reject }; setGroup(source);
      });
    },
    finish: (accountId: string, chainId: number) => {
      pending.current?.resolve({ accountId, chainId }); pending.current = null; setGroup(null);
    },
  };
}
