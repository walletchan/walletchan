import { notifyBunkerPendingChanged } from "./pendingRequests";
import { runBunkerEffect } from "./barrier";
import { getAccountById } from "../accountStorage";
import { withStorageLock } from "../storageLock";
import { boundedString } from "./stateCodec";
import { encodeMultiSendTransactions } from "../safe/multiSend";
import type { SafeCall } from "../safe/types";
import type { BunkerRoute } from "./types";

const KEY = "safeBunkerInboxV1";
export interface BunkerInboxEntry { id: string; accountId: string; chainId: number; calls: SafeCall[]; routes: BunkerRoute[] }
export async function readBunkerInbox(): Promise<BunkerInboxEntry[]> {
  const value = (await chrome.storage.local.get(KEY))[KEY];
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) throw new Error("Invalid Bunker pending inbox");
  const ids = new Set();
  for (const r of value) {
    if (!r || Object.keys(r).some((k) => !["id", "accountId", "chainId", "calls", "routes"].includes(k))) throw new Error("Invalid Bunker inbox entry");
    boundedString(r.id); boundedString(r.accountId);
    if (ids.has(r.id) || r.chainId !== 11155111 || !Array.isArray(r.calls) || r.calls.length > 99 || !Array.isArray(r.routes) || r.routes.length !== 1) throw new Error("Invalid Bunker inbox identity");
    ids.add(r.id); encodeMultiSendTransactions(r.calls);
    for (const route of r.routes) {
      if (!route || !["wallet", "injected", "walletConnect", "batch"].includes(route.kind)) throw new Error("Invalid Bunker request route");
      boundedString(route.origin, 2048); boundedString(route.requestId);
      if (JSON.stringify(route).length > 4096) throw new Error("Bunker route exceeds limits");
    }
  }
  return value;
}
export function enqueueBunkerRequest(input: BunkerInboxEntry) { return runBunkerEffect(() => enqueue(input)); }
async function enqueue(input: BunkerInboxEntry) {
  const account = await getAccountById(input.accountId);
  if (account?.type !== "safeBunker" || account.chainId !== input.chainId) throw new Error("Bunker chain/account mismatch");
  return withStorageLock(`local:${KEY}`, async () => {
    const inbox = await readBunkerInbox(); const old = inbox.find((r) => r.id === input.id);
    if (old && JSON.stringify(old) !== JSON.stringify(input)) throw new Error("Bunker request ID conflict");
    if (!old) {
      if (inbox.length >= 100) throw new Error("Bunker queue limit reached");
      if (input.calls.length > 99) throw new Error("Bunker batch exceeds 99 user calls");
      encodeMultiSendTransactions(input.calls); inbox.push(input);
      await chrome.storage.local.set({ [KEY]: inbox });
    }
    notifyBunkerPendingChanged();
    chrome.runtime.sendMessage({ type: "newSafeBunkerRequest", accountId: account.id, requestId: input.id }).catch(() => {});
    return { id: input.id };
  });
}
export async function acknowledgeBunkerInbox(id: string) {
  return withStorageLock(`local:${KEY}`, async () => {
    const entries = await readBunkerInbox(); await chrome.storage.local.set({ [KEY]: entries.filter((e) => e.id !== id) });
    notifyBunkerPendingChanged();
  });
}

/** Public unsigned intake can be cancelled even while the seed vault is locked. */
export async function cancelBunkerInboxRequests(scope: { origin?: string; topic?: string }) {
  const { writeResultToStorage } = await import("../transactions/runtime");
  await withStorageLock(`local:${KEY}`, async () => {
    const entries = await readBunkerInbox();
    const matches = (entry: BunkerInboxEntry) => entry.routes.some((route) => {
      if (scope.topic) return route.topic === scope.topic;
      if (!scope.origin || route.topic || route.kind === "wallet" || typeof route.tabId !== "number") return false;
      try { return new URL(route.origin).origin === scope.origin; } catch { return false; }
    });
    const cancelled = entries.filter(matches);
    if (!cancelled.length) return;
    await chrome.storage.local.set({ [KEY]: entries.filter((entry) => !matches(entry)) });
    notifyBunkerPendingChanged();
    for (const entry of cancelled) for (const route of entry.routes) {
      await writeResultToStorage(`${route.kind === "batch" ? "batchTxAck" : "txResult"}:${route.requestId}`, {
        success: false, error: "Bunker request connection ended", code: 4100,
      });
    }
  });
}
