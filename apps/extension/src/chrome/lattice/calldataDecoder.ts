/**
 * Picks a calldata decoder so the Lattice shows a contract call's function
 * and arguments, as Ledger does. Reuses WalletChan's own sources, unchanged:
 *
 * 1. The contract's verified ABI from `fetchContractAbi` (Sourcify, with its
 *    proxy resolution), the same ABI WalletChan's review screen decodes with.
 *    The device then shows parameter names.
 * 2. The selector lookups WalletChan already makes for transaction history:
 *    the Sourcify signature database, then 4byte.directory (oldest first, as
 *    gridplus-sdk picks). The device shows the function with `#1`-style labels.
 *
 * A function is used only when its selector matches and re-encoding the
 * decoded arguments reproduces the calldata exactly. Anything else,
 * including a failed or slow lookup, returns undefined and the device shows
 * the raw data, as before.
 */
import {
  decodeFunctionData,
  encodeFunctionData,
  parseAbiItem,
  toFunctionSelector,
  type AbiFunction,
  type Hex,
} from "viem";

import { FOURBYTE_DIRECTORY_API_URL, FOURBYTE_SOURCIFY_LOOKUP_URL } from "@/constants/externalUrls";
import { fetchContractAbi } from "@/lib/decoder/fetchAbi";
import { fetchJsonBounded } from "../network/boundedHttp";
import { encodeEvmDecoder, encodeEvmDecoderForFunction, LatticeDecoderUnsupportedError } from "./protocol";

const LOOKUP = { timeoutMs: 5_000, maxBytes: 256 * 1024 };
/** fetchContractAbi allows 8 s per request; the device prompt waits at most this long. */
const ABI_WAIT_MS = 5_000;
const candidatesBySelector = new Map<string, string[]>();
const abiByContract = new Map<string, readonly unknown[] | null>();

async function sourcifyCandidates(selector: string): Promise<string[]> {
  const url = new URL(FOURBYTE_SOURCIFY_LOOKUP_URL);
  url.searchParams.append("function", selector);
  const { response, data } = await fetchJsonBounded(url, { method: "GET" }, LOOKUP);
  const entries = (data as { result?: { function?: Record<string, unknown> } } | null)?.result?.function?.[selector];
  if (!response.ok || !Array.isArray(entries)) return [];
  return entries
    .filter((entry): entry is { name: string; filtered?: boolean } => typeof entry?.name === "string" && entry.filtered !== true)
    .map((entry) => entry.name);
}

async function fourbyteCandidates(selector: string): Promise<string[]> {
  const url = new URL(FOURBYTE_DIRECTORY_API_URL);
  url.searchParams.append("hex_signature", selector);
  const { response, data } = await fetchJsonBounded(url, { method: "GET" }, LOOKUP);
  const results = (data as { results?: unknown } | null)?.results;
  if (!response.ok || !Array.isArray(results)) return [];
  return results
    .filter((entry): entry is { text_signature: string; created_at?: string } => typeof entry?.text_signature === "string")
    .sort((a, b) => Date.parse(a.created_at ?? "") - Date.parse(b.created_at ?? ""))
    .map((entry) => entry.text_signature);
}

async function candidatesFor(selector: string): Promise<string[]> {
  const cached = candidatesBySelector.get(selector);
  if (cached) return cached;
  const found: string[] = [];
  for (const result of await Promise.allSettled([sourcifyCandidates(selector), fourbyteCandidates(selector)])) {
    if (result.status === "fulfilled") for (const name of result.value) if (!found.includes(name)) found.push(name);
  }
  if (found.length > 0) candidatesBySelector.set(selector, found);
  return found;
}

/** The verified ABI, or null. A slow lookup is not cached, so the next signature tries again. */
async function verifiedAbi(chainId: number, address: string): Promise<readonly unknown[] | null> {
  const key = `${chainId}:${address.toLowerCase()}`;
  if (abiByContract.has(key)) return abiByContract.get(key) ?? null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = Symbol("timeout");
  const result = await Promise.race([
    fetchContractAbi({ address, chainId }).then(
      ({ abi }) => (Array.isArray(abi) ? (abi as readonly unknown[]) : null),
      () => null,
    ),
    new Promise<typeof timedOut>((resolve) => {
      timer = setTimeout(() => resolve(timedOut), ABI_WAIT_MS);
    }),
  ]);
  clearTimeout(timer);
  if (result === timedOut) return null;
  abiByContract.set(key, result);
  return result;
}

/** True when `item` decodes `data` and re-encodes to the same bytes. */
function fitsExactly(item: AbiFunction, data: Hex): boolean {
  try {
    const { args } = decodeFunctionData({ abi: [item], data });
    return encodeFunctionData({ abi: [item], functionName: item.name, args }).toLowerCase() === data.toLowerCase();
  } catch {
    return false;
  }
}

function isFunction(item: unknown): item is AbiFunction {
  return typeof item === "object" && item !== null && (item as { type?: unknown }).type === "function";
}

export async function latticeDecoderFor(tx: {
  data?: Hex;
  to?: string | null;
  chainId?: number;
}): Promise<Uint8Array | undefined> {
  const { data } = tx;
  if (!data || !/^0x[0-9a-fA-F]{8}/.test(data)) return undefined;
  const selector = data.slice(0, 10).toLowerCase();
  const [abi, candidates] = await Promise.all([
    tx.to && tx.chainId ? verifiedAbi(tx.chainId, tx.to) : null,
    candidatesFor(selector),
  ]);
  try {
    for (const item of abi ?? []) {
      if (isFunction(item) && toFunctionSelector(item) === selector && fitsExactly(item, data)) {
        return encodeEvmDecoderForFunction(item);
      }
    }
    for (const signature of candidates) {
      const item = (() => {
        try {
          return parseAbiItem(`function ${signature}`) as AbiFunction;
        } catch {
          return null;
        }
      })();
      // The first exact match is the reading.
      if (item && fitsExactly(item, data)) return encodeEvmDecoder(signature);
    }
  } catch (error) {
    // A type the Lattice cannot show means raw data.
    if (error instanceof LatticeDecoderUnsupportedError) return undefined;
    throw error;
  }
  return undefined;
}

/** Test hook: forget cached lookups. */
export function clearLatticeDecoderCache(): void {
  candidatesBySelector.clear();
  abiByContract.clear();
}
