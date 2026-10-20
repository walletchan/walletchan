import { parseAbi, type PublicClient } from "viem";
import { ENTRY_POINT_V07 } from "../feePayment/constants";
import { BUNKER_CONFIRMATIONS } from "./network";
import { readBunkerLive, bunkerEntry } from "./live";
import { deriveBunkerOwner } from "./derivation";
import { withBunkerDraftSeed } from "./crypto";
import type { BunkerAccess } from "./access";
import type { BunkerState } from "./types";

/** A signed SafeOp exposed to estimation cannot be discarded until its signed
 * validity window has ended on a confirmed canonical block. Keep all evidence.
 * For submitted/ambiguous operations, unchanged EntryPoint nonce at that same
 * block proves non-inclusion independently of bundler availability. */
export async function expireUnsubmittedBunkerFees(state: BunkerState, client: PublicClient, current: BunkerAccess, head: bigint) {
  const candidates = state.operations.filter(op => ["signed", "ambiguous", "pending"].includes(op.state) && op.signature && !op.outer && !op.receipt &&
    op.review?.feePayment && op.review.feePayment.validUntil > 0);
  if (!candidates.length || head < BUNKER_CONFIRMATIONS - 1n) return false;
  const number = head - BUNKER_CONFIRMATIONS + 1n;
  const block = await client.getBlock({ blockNumber: number });
  if (!block.hash) return false;
  const expired = candidates.filter(op => block.timestamp > BigInt(op.review!.feePayment!.validUntil));
  if (!expired.length) return false;
  const live = await readBunkerLive(state, client, number);
  const nonce = await client.readContract({ address: ENTRY_POINT_V07,
    abi: parseAbi(["function getNonce(address sender,uint192 key) view returns(uint256)"]),
    functionName: "getNonce", args: [state.plan.address, 0n], blockNumber: number });
  const owner = await withBunkerDraftSeed(await bunkerEntry(state.id), current(), seed => deriveBunkerOwner(seed, state.chainId, state.ownerIndex));
  if (live.owners[0] !== owner || (await client.getBlock({ blockNumber: number })).hash !== block.hash) return false;
  current(); let changed = false;
  for (const op of expired) {
    const review = op.review!;
    if (review.ownerIndex !== state.ownerIndex || live.nonce !== String(review.nonce) || nonce !== BigInt(review.feePayment!.userOperation.nonce)) continue;
    op.state = "invalidated";
    op.error = op.userOperationHash
      ? `${op.error ? `${op.error.slice(0, 320)} ` : ""}Gas-payment signature expired without execution. Create a new request.`
      : "Gas-payment signature expired before submission. Create a new request.";
    changed = true;
  }
  // Reuse the existing canonical anchor: a reorg of this expiry proof blocks
  // every subsequent review/signature until recovery revalidates authority.
  if (changed) state.plan.verifiedBlock = { number: number.toString(), hash: block.hash };
  return changed;
}
