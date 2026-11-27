import { useCallback, useEffect, useRef, useState } from "react";
import type {
  SignatureHistoryEntry,
  SignatureHistoryState,
} from "@/chrome/signatureHistory/types";

export async function activityMessage<T>(message: unknown): Promise<T> {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.success)
    throw new Error(response?.error || "Could not access activity history");
  return response.data as T;
}
export function useSignatureHistory(
  address?: string,
  chainId?: number | null,
  summary = false,
  from?: number,
  to?: number,
) {
  const [entries, setEntries] = useState<SignatureHistoryEntry[]>([]);
  const [state, setState] = useState<SignatureHistoryState | null>(null);
  const [transactionCount, setTransactionCount] = useState<number>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const result = await activityMessage<{
        transactionCount?: number;
        entries: SignatureHistoryEntry[];
        state: SignatureHistoryState;
      }>({
        type: summary ? "getActivityHistorySummary" : "getSignatureHistory",
        filter: { ownerAddress: address, chainId, from, to },
      });
      if (current !== generation.current) return;
      setTransactionCount(result.transactionCount);
      setEntries(result.entries);
      setState(result.state);
    } catch (cause) {
      if (current !== generation.current) return;
      setEntries([]);
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not load signed messages",
      );
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [address, chainId, summary, from, to]);
  useEffect(() => {
    setEntries([]);
    setState(null);
    void refresh();
    const listener = (message: { type?: string }) => {
      if (
        message.type === "signatureHistoryUpdated" ||
        (summary &&
          ["txHistoryUpdated", "safeProposalsUpdated"].includes(
            message.type ?? "",
          ))
      )
        void refresh();
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => {
      // This ref is a request-generation counter, not a DOM node.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, [refresh, summary]);
  return { entries, transactionCount, state, loading, error, refresh };
}
