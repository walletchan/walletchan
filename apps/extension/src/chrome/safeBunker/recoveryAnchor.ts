import type { PublicClient } from "viem";
import type { BunkerAccess } from "./access";
import type { BunkerState } from "./types";
import { BUNKER_CONFIRMATIONS } from "./network";
import { bunkerEntry, readBunkerLive } from "./live";
import { withBunkerDraftSeed } from "./crypto";
import { deriveBunkerOwner } from "./derivation";

/** Only explicit master recovery may replace an orphaned proof. No signing here.
 * Caller holds the Bunker and secret-operation locks and persists before release. */
export async function recoverBunkerAnchor(state: BunkerState, client: PublicClient, current: BunkerAccess): Promise<boolean> {
  current();
  const anchor = state.plan.verifiedBlock;
  if (!anchor) return false;
  const head = await client.getBlockNumber();
  if (BigInt(anchor.number) <= head && (await client.getBlock({ blockNumber: BigInt(anchor.number) })).hash === anchor.hash) return false;
  if (head < BUNKER_CONFIRMATIONS - 1n) throw new Error("Chain reorganization detected. Recovery required.");
  const block = await client.getBlock({ blockNumber: head - BUNKER_CONFIRMATIONS + 1n });
  if (!block.hash) throw new Error("Chain reorganization detected. Recovery required.");
  const candidate = structuredClone(state);
  delete candidate.plan.verifiedBlock;
  // Bypass only the orphaned anchor, retaining all infrastructure/configuration checks.
  const live = await readBunkerLive(candidate, client, block.number);
  const invalidated = state.operations.filter(op => op.state === "invalidated" && op.signature && op.review);
  const indices = [...new Set(invalidated.map(op => op.review!.ownerIndex))];
  const usable = await withBunkerDraftSeed(await bunkerEntry(state.id), current(), seed =>
    new Set(indices.filter(index => deriveBunkerOwner(seed, state.chainId, index) === live.owners[0])));
  if ((await client.getBlock({ blockNumber: block.number })).hash !== block.hash) throw new Error("Chain reorganization detected. Recovery required.");
  current();
  state.plan.verifiedBlock = { number: block.number.toString(), hash: block.hash };
  state.exposureUnknown = true;
  // The old expiry/rotation proof no longer establishes cancellation. Keep exact
  // signed evidence outstanding until canonical reconciliation or recovery rotation.
  for (const op of invalidated) if (usable.has(op.review!.ownerIndex)) {
    op.state = op.outer || op.userOperationHash ? "ambiguous" : "signed";
    op.published = false; delete op.error;
  }
  state.recovery = { targetOwner: live.owners[0], scanBlock: state.plan.fromBlock, targetBlock: block.number.toString(),
    deriveIndex: 0, matchedIndex: null, usedOwners: [...state.usedOwners] };
  return true;
}
