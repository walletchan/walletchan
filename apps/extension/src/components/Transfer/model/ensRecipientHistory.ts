import { normalize } from "viem/ens";
import type { EnsRecipientHistory } from "@/chrome/ensBrowsing/recipientHistory";

export const ENS_RECENT_CHANGE_MS = 30 * 24 * 60 * 60 * 1000;

export function recipientEnsHistoryName(input: string): string | null {
  if (input.length > 255) return null;
  try {
    const name = normalize(input.trim().replace(/\.$/, ""));
    return name.endsWith(".eth") && !name.endsWith(".base.eth") ? name : null;
  } catch { return null; }
}

export function parseEnsRecipientHistory(response: unknown): EnsRecipientHistory {
  const value = response as { success?: boolean; history?: EnsRecipientHistory } | null;
  if (value?.success !== true || !value.history) throw new Error("ENS history unavailable");
  const history = value.history;
  const timestamp = history.addressUpdatedAt;
  if (timestamp !== null && (!Number.isSafeInteger(timestamp) || timestamp <= 0 || timestamp > Date.now() + 60_000)) {
    throw new Error("Invalid ENS timestamp");
  }
  return { addressUpdatedAt: timestamp };
}

export function recentEnsAddressUpdate(history: EnsRecipientHistory, now = Date.now()): number | null {
  const updatedAt = history.addressUpdatedAt;
  return updatedAt !== null && updatedAt <= now && now - updatedAt <= ENS_RECENT_CHANGE_MS ? updatedAt : null;
}

export function formatEnsUpdateAge(updatedAt: number, now = Date.now()): string {
  const elapsed = Math.max(0, now - updatedAt);
  if (elapsed < 60_000) return "just now";
  const [unit, duration] = elapsed < 3_600_000 ? ["minute", 60_000] as const
    : elapsed < 86_400_000 ? ["hour", 3_600_000] as const : ["day", 86_400_000] as const;
  return new Intl.RelativeTimeFormat("en", { numeric: "always" })
    .format(-Math.floor(elapsed / duration), unit);
}
