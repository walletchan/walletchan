import { isAddress } from "viem";
import { exactRecord } from "./record";

/** Public review/refresh inputs only. Calls remain the sole spending authority. */
export interface BunkerSwapToken {
  address: string; name: string; symbol: string; decimals: number;
  amount: string; priceUsd: number; logo: string | null;
}
export interface BunkerSwapContext { sell: BunkerSwapToken; buy: BunkerSwapToken; slippageBps: number }

export function decodeBunkerSwapContext(value: unknown): BunkerSwapContext {
  const record = exactRecord(value, ["sell", "buy", "slippageBps"]);
  const token = (value: unknown): BunkerSwapToken => {
    const t = exactRecord(value, ["address", "name", "symbol", "decimals", "amount", "priceUsd", "logo"]);
    const text = (v: unknown, limit: number) => typeof v === "string" && v.length > 0 && v.length <= limit && !Array.from(v).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
    if (t.address !== "native" && (typeof t.address !== "string" || !isAddress(t.address)) || !text(t.name, 128) || !text(t.symbol, 64) ||
      !Number.isInteger(t.decimals) || (t.decimals as number) < 0 || (t.decimals as number) > 255 ||
      typeof t.amount !== "string" || !/^[1-9][0-9]{0,77}$/.test(t.amount) || BigInt(t.amount) >= 2n ** 256n ||
      typeof t.priceUsd !== "number" || !Number.isFinite(t.priceUsd) || t.priceUsd < 0 || t.logo !== null && !text(t.logo, 2048)) throw new Error("Invalid Bunker swap context");
    return t as unknown as BunkerSwapToken;
  };
  if (!Number.isInteger(record.slippageBps) || (record.slippageBps as number) < 0 || (record.slippageBps as number) > 10000) throw new Error("Invalid Bunker swap context");
  return { sell: token(record.sell), buy: token(record.buy), slippageBps: record.slippageBps as number };
}
