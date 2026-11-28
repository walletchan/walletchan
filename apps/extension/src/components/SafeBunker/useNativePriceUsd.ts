import { useEffect, useState } from "react";

/** Shared cached native-price transport; stale chain responses never reach the UI. */
export function useNativePriceUsd(chainId: number): number | null {
  const [price, setPrice] = useState<{ chainId: number; usd: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    setPrice(null);
    chrome.runtime.sendMessage({ type: "fetchNativePrice", chainId }, (response) => {
      if (cancelled || chrome.runtime.lastError) return;
      const usd = Number(response?.priceUsd);
      if (response?.success && Number.isFinite(usd) && usd > 0) setPrice({ chainId, usd });
    });
    return () => { cancelled = true; };
  }, [chainId]);
  return price?.chainId === chainId ? price.usd : null;
}
