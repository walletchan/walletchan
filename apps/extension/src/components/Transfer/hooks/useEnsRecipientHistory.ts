import { useEffect, useState } from "react";
import type { EnsRecipientHistory } from "@/chrome/ensBrowsing/recipientHistory";
import { parseEnsRecipientHistory, recipientEnsHistoryName } from "../model/ensRecipientHistory";

type HistoryState = { key: string; status: "loading" | "ready" | "unavailable"; history?: EnsRecipientHistory };

/** Send only. Key results to the exact forward-resolved destination, never a reverse name. */
export function useEnsRecipientHistory(recipient: string, address: string | null, chainId: number) {
  const name = address ? recipientEnsHistoryName(recipient) : null;
  const key = name ? JSON.stringify([name, address, chainId]) : "";
  const [state, setState] = useState<HistoryState>({ key: "", status: "loading" });
  useEffect(() => {
    if (!key) return;
    let active = true;
    setState({ key, status: "loading" });
    const timer = setTimeout(() => {
      active = false;
      setState({ key, status: "unavailable" });
    }, 20_000);
    chrome.runtime.sendMessage({ type: "getEnsRecipientHistory", ensName: name, chainId })
      .then((response) => {
        const history = parseEnsRecipientHistory(response);
        if (active) setState({ key, status: "ready", history });
      })
      .catch(() => { if (active) setState({ key, status: "unavailable" }); })
      .finally(() => clearTimeout(timer));
    return () => { active = false; clearTimeout(timer); };
  }, [key, name, chainId]);
  if (!key) return null;
  return state.key === key ? state : { key, status: "loading" as const };
}
