import { useEffect, useRef } from "react";

/** Recover durable request surfaces after another renderer resolves the request. */
export function useResolvedTransactionNavigation({
  enabled, requestId, onResolved,
}: {
  enabled: boolean;
  requestId: string | undefined;
  onResolved: () => void;
}) {
  const onResolvedRef = useRef(onResolved);
  onResolvedRef.current = onResolved;

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let revision = 0;
    let resolved = false;
    const reconcile = async () => {
      const currentRevision = ++revision;
      try {
        const stored = await chrome.storage.local.get("pendingTxRequests");
        if (disposed || resolved || currentRevision !== revision) return;
        const pending = stored.pendingTxRequests as { id: string }[] | undefined;
        if (requestId && pending?.some((request) => request.id === requestId)) return;
        resolved = true;
        onResolvedRef.current();
      } catch {
        // An unavailable storage read is not evidence of request resolution.
      }
    };
    const onStorageChanged = (
      changes: Record<string, chrome.storage.StorageChange>, area: string,
    ) => {
      if (area === "local" && changes.pendingTxRequests) void reconcile();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void reconcile();
    };
    chrome.storage.onChanged.addListener(onStorageChanged);
    window.addEventListener("focus", reconcile);
    document.addEventListener("visibilitychange", onVisible);
    void reconcile();
    return () => {
      disposed = true;
      chrome.storage.onChanged.removeListener(onStorageChanged);
      window.removeEventListener("focus", reconcile);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, requestId]);
}
