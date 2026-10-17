import { getAccountById } from "../accountStorage";
import { capturePendingRequestAuthorizationCommitSnapshot, validatePendingRequestAuthorization } from "../requests/pendingRequestLifecycle";
import type { BunkerOperation, BunkerState } from "./types";

/** Snapshot every contributing route before reads, then check all synchronously at release. */
export async function authorizeBunkerOperation(state: BunkerState, op: BunkerOperation) {
  const account = await getAccountById(state.accountId);
  if (!account || account.type !== "safeBunker" || account.seedVaultId !== state.id || account.address.toLowerCase() !== state.plan.address || account.chainId !== 11155111) throw new Error("Bunker account changed");
  const contexts = op.routes.map((r) => ({ id: r.requestId, origin: r.topic ? `walletconnect:${r.topic}` : r.origin,
    senderOrigin: r.origin, tabId: r.tabId, frameId: r.frameId,
    ...(r.kind === "wallet" ? { trustedInternal: true as const } : {}),
    ...(r.topic ? { walletConnect: { topic: r.topic, requestId: r.remoteId, method: r.kind === "batch" ? "wallet_sendCalls" : "eth_sendTransaction" } } : {}),
  }));
  const guards = await Promise.all(contexts.map(capturePendingRequestAuthorizationCommitSnapshot));
  const current = () => { if (!guards.every((g) => g.isCurrent())) throw new Error("Bunker request authorization changed"); };
  for (let i = 0; i < contexts.length; i++) {
    const result = await validatePendingRequestAuthorization(op.routes[i].kind === "batch" ? "batchTransaction" : "transaction", contexts[i]);
    if (!result.authorized) throw new Error(result.error); current();
  }
  current(); return current;
}
