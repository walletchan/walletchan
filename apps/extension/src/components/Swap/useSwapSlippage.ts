import { useCallback, useEffect, useState } from "react";
import { DEFAULT_SLIPPAGE_BPS } from "@/chrome/swapApi";

export function useSwapSlippage(initialSlippageBps?: number) {
  const [slippageBps, setSlippageBpsState] = useState(initialSlippageBps ?? DEFAULT_SLIPPAGE_BPS);

  useEffect(() => {
    if (initialSlippageBps !== undefined) return;
    chrome.storage.sync.get("swapSlippageBps", (result) => {
      const stored = result.swapSlippageBps;
      if (typeof stored === "number" && stored > 0 && stored <= 10_000) {
        setSlippageBpsState(stored);
      }
    });
  }, [initialSlippageBps]);

  const setSlippageBps = useCallback((value: number) => {
    setSlippageBpsState(value);
    chrome.storage.sync.set({ swapSlippageBps: value });
  }, []);

  return { slippageBps, setSlippageBps };
}
