import { namehash } from "viem";
import { normalize } from "viem/ens";
import { getEnsHistoryBlockTimestamp, querySubgraph } from "./contenthashHistory";

export type EnsRecipientHistory = {
  addressUpdatedAt: number | null;
};

const cache = new Map<string, { expiresAt: number; history: EnsRecipientHistory }>();
const TTL_MS = 60_000;

function latestBlock(data: Record<string, unknown>, keys: string[]): string | null {
  const blocks = keys.flatMap((key) => {
    const rows = data[key];
    if (!Array.isArray(rows)) throw new Error("Incomplete ENS history");
    if (!rows.length) return [];
    const block = rows[0]?.blockNumber;
    if (!Number.isSafeInteger(block) || block <= 0) throw new Error("Invalid ENS event block");
    return [block as number];
  });
  return blocks.length ? String(Math.max(...blocks)) : null;
}

/** Advisory indexed history only; never supplies or replaces the RPC-resolved recipient. */
export async function getEnsRecipientHistory(ensName: unknown, chainId: unknown): Promise<EnsRecipientHistory> {
  if (typeof ensName !== "string" || ensName.length > 255
    || typeof chainId !== "number" || !Number.isSafeInteger(chainId) || chainId < 1 || chainId > 0x7fffffff) {
    throw new Error("Invalid ENS history request");
  }
  const name = normalize(ensName.trim().replace(/\.$/, ""));
  // Basenames use offchain/L2 records that this Ethereum subgraph cannot cover.
  if (!name.endsWith(".eth") || name.endsWith(".base.eth")) throw new Error("ENS history unsupported");
  const key = `${name}:${chainId}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.history;
  const node = namehash(name);
  const domainData = await querySubgraph("domain-query", `query RecipientDomain($node: ID!) {
    domain(id: $node) { resolver { id } }
  }`, { node });
  const domain = domainData.domain as { resolver?: { id?: unknown } } | null;
  if (!domain || typeof domain.resolver?.id !== "string" || domain.resolver.id.length > 160) {
    throw new Error("ENS resolver not indexed");
  }
  // Match useAddressResolver's ENSIP-11 coin type; include default EVM and ETH fallback events.
  const coinType = chainId === 1 ? "60" : String(BigInt(chainId) + 0x80000000n);
  const data = await querySubgraph("event-query", `query RecipientHistory(
    $resolver: String!, $coinTypes: [BigInt!]!
  ) {
    addrChangeds(first: 1, orderBy: blockNumber, orderDirection: desc, where: {resolver: $resolver}) { blockNumber }
    multicoinAddrChangeds(first: 1, orderBy: blockNumber, orderDirection: desc, where: {resolver: $resolver, coinType_in: $coinTypes}) { blockNumber }
  }`, { resolver: domain.resolver.id, coinTypes: [...new Set(["60", "2147483648", coinType])] });
  const block = latestBlock(data, ["addrChangeds", "multicoinAddrChangeds"]);
  const history = { addressUpdatedAt: block ? await getEnsHistoryBlockTimestamp(block) : null };
  // Bound public-name retention in memory; never write recipient queries to storage.
  if (cache.size >= 128) cache.delete(cache.keys().next().value!);
  cache.set(key, { expiresAt: Date.now() + TTL_MS, history });
  return history;
}
