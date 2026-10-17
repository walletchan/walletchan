import { ensureBunkerDeploymentHistory } from "./deploymentPublication";
import { ensureBunkerHistory } from "./history";
import { cancelUnauthorizedBunkerRequests } from "./cancellation";
import { decodeEventLog, keccak256, parseAbi, type Hex, type PublicClient } from "viem";
import { broadcastBunkerBytes } from "./broadcast";
import { WALLET_SECRET_OPERATION_LOCK_KEY, withStorageLock } from "../storageLock";
import { captureBunkerAccess } from "./access";
import { getCachedVaultKey } from "../sessionCache";
import { BUNKER_CONFIRMATIONS, bunkerClient } from "./network";
import { bunkerPayer } from "./payer";
import { readBunkerLive, verifyBunkerOwner } from "./live";
import { readBunkerState, writeBunkerState, loadStoredBunkerStates } from "./stateRepository";
import { deriveBunkerOwner } from "./derivation";
import { withBunkerDraftSeed } from "./crypto";
import { bunkerEntry } from "./live";
import { authorizeBunkerOperation } from "./authorization";
import { flushBunkerRejections, publishBunkerRoutes } from "./publication";
import { outstanding, stateForAccount } from "./operations";
import { verifyBunkerDeployment } from "./deployment";

const EVENTS = parseAbi(["event ExecutionSuccess(bytes32 indexed txHash,uint256 payment)", "event AddedOwner(address indexed owner)", "event RemovedOwner(address indexed owner)"]);
export async function reconcileBunker(id: string, client: PublicClient) {
  const current = captureBunkerAccess(); current();
  await flushBunkerRejections(id, current);
  await cancelUnauthorizedBunkerRequests(id); current();
  return withStorageLock(`bunker:${id}`, () => withStorageLock(WALLET_SECRET_OPERATION_LOCK_KEY, async () => {
    const state = await readBunkerState(id, current()); if (!state || state.archived) return;
    await ensureBunkerDeploymentHistory(state);
    if (!state.activated) {
      if (state.plan.deploymentHash) await verifyBunkerDeployment(state, client, current);
      return;
    }
    for (const op of state.operations) await ensureBunkerHistory(state, op);
    const head = await client.getBlockNumber();
    const live = await readBunkerLive(state, client);
    let changed = false;
    // Previously accepted evidence must stay canonical before another signature is prepared.
    for (const op of state.operations.filter((o) => o.receipt).slice(-10)) {
      const block = await client.getBlock({ blockNumber: BigInt(op.receipt!.block) });
      if (block.hash !== op.receipt!.blockHash) {
        state.exposureUnknown = true; op.state = "ambiguous";
        op.error = "Chain reorganization detected. Recovery required."; op.published = false; delete op.receipt; changed = true;
      }
    }
    for (const op of state.operations.filter(outstanding).slice(0, 5)) {
      let hash: Hex | undefined = op.outer?.hash;
      let receipt = hash ? await client.getTransactionReceipt({ hash }).catch(() => null) : null;
      if (!receipt || receipt.status !== "success") {
        const from = BigInt(op.scanBlock ?? state.plan.fromBlock);
        const to = head < from + 9999n ? head : from + 9999n;
        if (from <= to) {
          const logs = await client.getLogs({ address: state.plan.address, event: EVENTS[0], fromBlock: from, toBlock: to });
          if (logs.length > 2000) throw new Error("Bunker receipt scan limit reached");
          const found = logs.find((l) => l.args.txHash?.toLowerCase() === op.review?.safeTxHash);
          if (found) { hash = found.transactionHash; receipt = await client.getTransactionReceipt({ hash }); }
          else if (to < head) { op.scanBlock = (to + 1n).toString(); changed = true; }
        }
      }
      if (!receipt || receipt.status !== "success") {
        if (receipt?.status === "reverted") { op.error = "Execution reverted; owner unchanged. Review to retry or recover."; op.state = "signed"; delete op.outer; changed = true; }
        continue;
      }
      if (head < receipt.blockNumber + BUNKER_CONFIRMATIONS - 1n) continue;
      const canonical = await client.getBlock({ blockNumber: receipt.blockNumber });
      if (canonical.hash !== receipt.blockHash) continue;
      const logs = receipt.logs.filter((l) => l.address.toLowerCase() === state.plan.address).flatMap((l) => {
        try { return [decodeEventLog({ abi: EVENTS, data: l.data, topics: l.topics })]; } catch { return []; }
      });
      const r = op.review!;
      const expected = await withBunkerDraftSeed(await bunkerEntry(id), current(), (seed) => ({
        old: deriveBunkerOwner(seed, r.ownerIndex), next: deriveBunkerOwner(seed, r.nextIndex),
      }));
      if (!logs.some((l) => l.eventName === "ExecutionSuccess" && l.args.txHash.toLowerCase() === r.safeTxHash) ||
          !logs.some((l) => l.eventName === "AddedOwner" && l.args.owner.toLowerCase() === expected.next) ||
          !logs.some((l) => l.eventName === "RemovedOwner" && l.args.owner.toLowerCase() === expected.old)) continue;
      op.state = "confirmed"; delete op.error;
      op.receipt = { hash: receipt.transactionHash, block: receipt.blockNumber.toString(), blockHash: receipt.blockHash, timestamp: Number(canonical.timestamp) * 1000 };
      const matchesCurrent = live.owners[0] === expected.next && BigInt(live.nonce) >= BigInt(r.nonce) + 1n;
      if (matchesCurrent) { state.ownerIndex = r.nextIndex; state.nextIndex = r.nextIndex + 1; }
      else state.exposureUnknown = true;
      state.usedOwners = [...new Set([...state.usedOwners, expected.next])];
      if (op.kind === "recovery" && matchesCurrent) state.exposureUnknown = false;
      for (const other of state.operations) if (other.id !== op.id && outstanding(other) && other.review && other.review.nonce <= r.nonce) {
        other.state = "invalidated"; other.error = "Another same-nonce rotation executed";
      }
      changed = true;
    }
    if (changed) await writeBunkerState(state, current);
    for (const op of state.operations.filter((o) => o.state === "invalidated" && !o.published)) {
      await publishBunkerRoutes(state, op, "rejected"); current(); op.published = true;
      await writeBunkerState(state, current);
    }
    for (const op of state.operations.filter((o) => o.state === "confirmed" && !o.published)) {
      await publishBunkerRoutes(state, op, "confirmed", await client.getTransactionReceipt({ hash: op.receipt!.hash })); current(); op.published = true;
      await writeBunkerState(state, current);
    }
  }));
}
export async function retryBunkerOperation(accountId: string, operationId: string, client: PublicClient) {
  const current = captureBunkerAccess(); current(); const original = await stateForAccount(accountId);
  await reconcileBunker(original.id, client);
  return withStorageLock(`bunker:${original.id}`, () => withStorageLock(WALLET_SECRET_OPERATION_LOCK_KEY, async () => {
    const state = await stateForAccount(accountId); const op = state.operations.find((o) => o.id === operationId);
    if (!op || !outstanding(op) || !op.outer || keccak256(op.outer.raw) !== op.outer.hash) throw new Error("No exact transaction is available to retry");
    const { live } = await verifyBunkerOwner(state, current(), client, op.review!.nextIndex);
    if (live.configEpoch !== op.review!.configEpoch) throw new Error("Bunker authority changed");
    await bunkerPayer(op.outer.payerId, op.outer.payerAddress);
    if (live.nonce !== String(op.review!.nonce)) throw new Error("Safe nonce changed. Reconcile instead of retrying.");
    const gate = await authorizeBunkerOperation(state, op); current(); gate();
    const result = await broadcastBunkerBytes(client, op.outer.raw);
    op.state = result.broadcastUncertain ? "ambiguous" : "pending"; await writeBunkerState(state, current);
    await publishBunkerRoutes(state, op, "submitted");
    await writeBunkerState(state, current);
  }));
}
export function startBunkerReconciliation() {
  let cursor = 0;
  const run = async () => {
    if (!getCachedVaultKey()) return;
    const states = await loadStoredBunkerStates(); const client = await bunkerClient();
    const page = Array.from({ length: Math.min(5, states.length) }, (_, i) => states[(cursor + i) % states.length]);
    cursor = states.length ? (cursor + page.length) % states.length : 0;
    for (const entry of page) await reconcileBunker(entry.id, client).catch(() => undefined);
  };
  chrome.alarms.create("walletchan-bunker-reconcile", { periodInMinutes: 0.5 }).catch(() => {});
  chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === "walletchan-bunker-reconcile") void run().catch(() => {}); });
  void run().catch(() => {});
}
