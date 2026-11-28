import type { SwapMeta } from "../history/types";

/** Bounded display-only swap identity. Never used as transaction authority. */
export function decodeBunkerSwapMetadata(value: unknown): SwapMeta {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Bunker swap metadata");
  const record = value as Record<string, unknown>;
  const fields = ["sellTokenSymbol", "sellTokenLogo", "buyTokenSymbol", "buyTokenLogo"];
  if (Object.keys(record).length !== fields.length || fields.some(key => !(key in record))) throw new Error("Invalid Bunker swap metadata");
  const hasControl = (text: string) => Array.from(text).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
  const symbol = (value: unknown) => {
    if (typeof value !== "string" || !value.trim() || value.length > 64 || hasControl(value)) throw new Error("Invalid Bunker swap symbol");
    return value.trim();
  };
  const logo = (value: unknown) => {
    if (value === null) return null;
    if (typeof value !== "string" || value.length > 2048 || hasControl(value)) throw new Error("Invalid Bunker swap logo");
    return value;
  };
  return { sellTokenSymbol: symbol(record.sellTokenSymbol), sellTokenLogo: logo(record.sellTokenLogo),
    buyTokenSymbol: symbol(record.buyTokenSymbol), buyTokenLogo: logo(record.buyTokenLogo) };
}
