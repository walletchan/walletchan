import type { Account } from "@/chrome/types";
import type { BunkerDiscoveryResult } from "@/chrome/safeBunker/discovery";
export type DiscoveryRow = (BunkerDiscoveryResult | { chainId: number; status: "new" | "checking" | "error"; error?: string }) & { knownDeployment?: boolean };
export function deployedBunker(row?: DiscoveryRow) {
  return !!row && (row.knownDeployment === true || ["deployed", "local", "pending", "searching"].includes(row.status));
}
/** Loading or a failed probe must not erase a previously observed deployment. */
export function mergeDiscoveryRow(previous: DiscoveryRow | undefined, next: DiscoveryRow): DiscoveryRow {
  return { ...next, knownDeployment: ["checking", "error"].includes(next.status) && deployedBunker(previous) };
}

/** Seed cards can display known deployments without any chain requests. */
export function localBunkerDiscoveryRows(accounts: Account[]): Record<string, Record<number, DiscoveryRow>> {
  const rows: Record<string, Record<number, DiscoveryRow>> = {};
  for (const account of accounts) {
    if (account.type !== "safeBunker") continue;
    (rows[account.seedGroupId] ??= {})[account.chainId] = {
      chainId: account.chainId, address: account.address as `0x${string}`,
      status: account.deploymentPending ? "pending" : "local",
    };
  }
  return rows;
}

/** Discovery is advisory; only a known existing/pending deployment disables a chain. */
export function canDeployBunker(row?: DiscoveryRow): boolean {
  return !deployedBunker(row);
}

/** An empty result is conclusive only when every requested network was checked. */
export function noBunkersFound(chainIds: number[], rows: Record<number, DiscoveryRow>): boolean {
  return chainIds.length > 0 && chainIds.every(id => rows[id]?.status === "absent" && !deployedBunker(rows[id]));
}
