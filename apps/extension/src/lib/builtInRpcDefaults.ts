import type { ChainEntry } from "@/constants/chainRegistry";

// Only retired shipped defaults are upgraded; distinct user endpoints retain precedence.
const RETIRED_DEFAULTS: Readonly<Record<number, ReadonlySet<string>>> = {
  11155111: new Set(["https://sepolia.drpc.org"]),
};

export function resolveBuiltInRpcUrl(chain: Pick<ChainEntry, "chainId" | "rpcUrl">, storedRpcUrl?: string): string {
  if (storedRpcUrl === undefined) return chain.rpcUrl;
  let normalized: string;
  try { normalized = new URL(storedRpcUrl).href.replace(/\/+$/, ""); }
  catch { return storedRpcUrl; }
  return RETIRED_DEFAULTS[chain.chainId]?.has(normalized) ? chain.rpcUrl : storedRpcUrl;
}
