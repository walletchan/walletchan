import type { BunkerDraftSummary } from "@/chrome/safeBunker/record";

interface DraftResponse { success: boolean; draft?: BunkerDraftSummary; error?: string }
export function sendDraftCommand(message: { type: "createSafeBunkerDraft"; id: string; name: string }): Promise<DraftResponse> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: DraftResponse | undefined) => {
      if (chrome.runtime.lastError || !response?.success) {
        reject(new Error(response?.error ?? "Could not prepare Bunker deployment. Retry."));
      } else resolve(response);
    });
  });
}
