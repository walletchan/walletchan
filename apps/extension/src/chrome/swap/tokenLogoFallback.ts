import { metamaskTokenIconUrl } from "@/constants/externalUrls";
import {
  SWAP_API_BASE,
  SWAP_REQUEST_TIMEOUT_MS,
  TOKEN_PRICE_RESPONSE_MAX_BYTES,
} from "./constants";
import { fetchSwapJson } from "./transport";

export async function fetchFallbackTokenLogo(
  chainId: number,
  address: string,
): Promise<string | null> {
  const query = new URLSearchParams({ chainId: String(chainId), address });
  const { response, data } = await fetchSwapJson<{ logoUrl?: unknown }>(
    `${SWAP_API_BASE}/token-list?${query}`,
    {
      timeoutMs: SWAP_REQUEST_TIMEOUT_MS,
      maxBytes: TOKEN_PRICE_RESPONSE_MAX_BYTES,
    },
  );
  if (!response.ok || typeof data.logoUrl !== "string") return null;
  const expected = metamaskTokenIconUrl(chainId, address);
  return data.logoUrl === expected ? expected : null;
}
