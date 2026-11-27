import { previewAssets } from "./previewAssets";

/** Deterministic public token metadata for preview screens; never a live lookup. */
export function previewTokenMetadata(tokenAddress: unknown, customAddress: string) {
  const normalized = String(tokenAddress || "").toLowerCase();
  if (normalized === customAddress.toLowerCase()) {
    return { success: true, data: { name: "WalletChan", symbol: "WCHAN", decimals: 18, logoUrl: previewAssets.brand.walletChan } };
  }
  const native = normalized === "native";
  return { success: true, data: {
    name: native ? "Ether" : "USD Coin", symbol: native ? "ETH" : "USDC",
    decimals: native ? 18 : 6,
    logoUrl: native ? previewAssets.chains.ethereum : previewAssets.tokens.usdc,
  } };
}
