import { BASE_RECONCILIATION_RPCS, RETIRED_SEPOLIA_RPC_URL, RETIRED_TEMPO_RPC_URL } from "@/constants/externalUrls";
import type { ChainEntry } from "@/constants/chainRegistry";

// Only retired shipped defaults are upgraded; distinct user endpoints retain precedence.
const RETIRED_DEFAULTS: Readonly<Record<number, ReadonlySet<string>>> = {
  11155111: new Set([RETIRED_SEPOLIA_RPC_URL]),
  8453: new Set([BASE_RECONCILIATION_RPCS[1]]),
  4217: new Set([RETIRED_TEMPO_RPC_URL]),
};

export function resolveBuiltInRpcUrl(chain: Pick<ChainEntry, "chainId" | "rpcUrl">, storedRpcUrl?: string): string {
  if (storedRpcUrl === undefined) return chain.rpcUrl;
  let normalized: string;
  try { normalized = new URL(storedRpcUrl).href.replace(/\/+$/, ""); }
  catch { return storedRpcUrl; }
  return RETIRED_DEFAULTS[chain.chainId]?.has(normalized) ? chain.rpcUrl : storedRpcUrl;
}
