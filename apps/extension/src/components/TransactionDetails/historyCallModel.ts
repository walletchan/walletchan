import { toHex } from "viem";
import type { CompletedTransaction } from "@/chrome/txHistoryStorage";
import type { ERC5792Call } from "@/chrome/erc5792Types";
import { decodeErc7821Batch, looksLikeErc7821SelfBatch } from "@/lib/erc7821Decode";

/** Bunker snapshots contain only reviewed user calls, without the final owner swap. */
export function getHistoryCalls(tx: CompletedTransaction): ERC5792Call[] | null {
  if (tx.safeBunkerMeta?.calls.length) return tx.safeBunkerMeta.calls.map((call) => ({
    to: call.to, data: call.data, value: toHex(BigInt(call.value)),
  }));
  return looksLikeErc7821SelfBatch(tx.tx) ? decodeErc7821Batch(tx.tx.data) : null;
}
