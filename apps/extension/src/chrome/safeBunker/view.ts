import { BUNKER_REVERT_WARNINGS_KEY, hasBunkerRevertWarning, readBunkerRevertWarnings } from "./revertWarning";
import { getStoredResolvedChainById } from "@/lib/chains";
import { readSignedBunkerDeployment } from "./deploymentPublication";
import { getBunkerHistoryRotation } from "./historyRotation";
import { WALLET_SECRET_STORAGE_LOCK_KEY, withStorageLock } from "../storageLock";
import { BUNKER_PENDING_KEY, readBunkerPendingIndex, projectBunkerPending, getPendingBunkerRequests, notifyBunkerPendingChanged, type PendingBunkerRequest } from "./pendingRequests";
import { cancelUnauthorizedBunkerRequests } from "./cancellation";
import { getAccounts } from "../accountStorage";
import { captureBunkerAccess } from "./access";
import { bunkerEntry } from "./live";
import { loadStoredBunkerStates, readBunkerState } from "./stateRepository";
import { queueBunkerOperation } from "./operations";
import { acknowledgeBunkerInbox, readBunkerInbox } from "./inbox";
import type { BunkerAccountView, BunkerState } from "./types";
export async function projectBunkerView(state: BunkerState): Promise<BunkerAccountView> {
  const entry = await bunkerEntry(state.id);
  const network = await getStoredResolvedChainById(state.chainId);
  const deployment = state.plan.raw && state.plan.deploymentHash ? await readSignedBunkerDeployment(state) : null;
  const payer = deployment ? (await getAccounts()).find(a => a.address.toLowerCase() === deployment.sender) : null;
  return { id: state.accountId, draftId: state.id, name: entry.header.name, safeAddress: state.plan.address, chainId: state.chainId, chainName: network?.name ?? state.chainName, explorer: network?.explorer ?? "", nativeCurrencySymbol: network?.nativeCurrency.symbol ?? "",
    ownerIndex: state.ownerIndex, deployed: state.activated, archived: state.archived, exposureUnknown: state.exposureUnknown, defaultPayer: state.defaultPayer,
    ...(deployment && payer ? { deploymentPayerId: payer.id, deploymentGas: { gasLimit: deployment.tx.gas!.toString(), maxFeePerGas: (deployment.tx.maxFeePerGas ?? 0n).toString(), maxPriorityFeePerGas: (deployment.tx.maxPriorityFeePerGas ?? 0n).toString() } } : {}),
    seedGroupId: state.seedGroupId, deploymentHash: state.plan.deploymentHash, recovering: !!state.recovery,
    ...(state.recovery ? { recoveryProgress: `${state.recovery.deriveIndex} owner addresses checked` } : {}),
    operations: state.operations.map((o) => ({ id: o.id, calls: o.calls, origins: o.routes.map((r) => r.origin), kind: o.kind,
      rotation: getBunkerHistoryRotation(state.plan.address, o.review), state: o.state, createdAt: o.createdAt, txHash: o.receipt?.hash ?? o.outer?.hash, error: o.error,
      ...(o.review ? { payerId: o.review.payerId, payerAddress: o.review.payerAddress, maxFee: o.review.maxFee, gas: o.review.gas, reviewDigest: o.review.digest, reviewExpiresAt: o.review.expiresAt } : {}) })) };
}
export async function drainBunkerInbox(accountId: string) {
  captureBunkerAccess()();
  const account = (await getAccounts()).find((a) => a.id === accountId);
  if (account?.type === "safeBunker") await cancelUnauthorizedBunkerRequests(account.bunkerId);
  const entries = (await readBunkerInbox()).filter((e) => e.accountId === accountId);
  for (const entry of entries) {
    try { await queueBunkerOperation(entry); await acknowledgeBunkerInbox(entry.id); }
    catch { /* Preserve unsigned request for deliberate retry or rejection. */ }
  }
}
export async function findBunkerRequestAccount(requestId: string) {
  const accounts = await getAccounts();
  const inbox = (await readBunkerInbox()).find((r) => r.id === requestId);
  if (inbox) return accounts.find((a) => a.id === inbox.accountId && a.type === "safeBunker") ?? null;
  captureBunkerAccess()();
  for (const stored of await loadStoredBunkerStates()) {
    const state = await readBunkerState(stored.id);
    if (state?.operations.some((o) => o.id === requestId)) return accounts.find((a) => a.id === state.accountId && a.type === "safeBunker") ?? null;
  }
  return null;
}

export async function findPendingBunkerAccount() {
  await synchronizeBunkerPendingIndex();
  const [accounts, requests] = await Promise.all([getAccounts(), getPendingBunkerRequests()]);
  return accounts.find((a) => a.id === requests[0]?.accountId && a.type === "safeBunker") ?? null;
}

/** Idempotent repair for journals created before notification metadata existed. */
export async function synchronizeBunkerPendingIndex() {
  const current = captureBunkerAccess(); current();
  await withStorageLock(WALLET_SECRET_STORAGE_LOCK_KEY, async () => {
    const pending: PendingBunkerRequest[] = [];
    const warnings: string[] = [];
    for (const stored of await loadStoredBunkerStates()) {
      const state = await readBunkerState(stored.id, current());
      if (state) { pending.push(...projectBunkerPending(state)); if (hasBunkerRevertWarning(state)) warnings.push(state.accountId); }
    }
    const previous = await readBunkerPendingIndex();
    const sort = (items: typeof pending) => items.sort((a, b) => a.id.localeCompare(b.id));
    const previousWarnings = await readBunkerRevertWarnings();
    if (JSON.stringify(sort(previous)) !== JSON.stringify(sort(pending)) || JSON.stringify(previousWarnings.sort()) !== JSON.stringify(warnings.sort())) {
      current(); await chrome.storage.local.set({ [BUNKER_PENDING_KEY]: pending, [BUNKER_REVERT_WARNINGS_KEY]: warnings });
      notifyBunkerPendingChanged();
    }
    current();
  });
}
