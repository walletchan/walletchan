import { keccak256, type Hex } from "viem";
import type { RawBroadcastClient } from "../localSigning/types";

/** Signed Bunker calldata must never be reflected into logs or UI errors. */
export async function broadcastBunkerBytes(client: RawBroadcastClient, raw: Hex) {
  const txHash = keccak256(raw);
  try {
    const result: unknown = await client.request({ method: "eth_sendRawTransaction", params: [raw] } as never, { retryCount: 0 });
    if (typeof result !== "string" || result.toLowerCase() !== txHash) throw new Error("Hash mismatch");
    return { txHash, broadcastUncertain: false };
  } catch { return { txHash, broadcastUncertain: true }; }
}
