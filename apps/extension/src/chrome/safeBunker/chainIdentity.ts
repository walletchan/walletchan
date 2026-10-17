/** Public, pure identity constants for the shared-phrase Bunker format. */
export const BUNKER_CHAIN_DERIVATION_VERSION = 2;
// ASCII "WCHN", within the hardened component's 31-bit payload.
export const BUNKER_ACCOUNT_NAMESPACE = 0x5743484e;
export const MAX_BUNKER_CHAIN_OWNER_INDEX = 0x7fffffff;
const COMPONENT_BASE = 0x80000000;

/** WalletChan represents chain IDs as positive safe integers; never coerce them. */
export function assertBunkerChainId(chainId: number): void {
  if (!Number.isSafeInteger(chainId) || chainId <= 0)
    throw new Error("Invalid Bunker chain ID");
}

/** Fixed-width, lossless high/low base-2^31 encoding; both components harden. */
export function bunkerOwnerPathComponents(chainId: number, index: number): number[] {
  assertBunkerChainId(chainId);
  if (!Number.isSafeInteger(index) || index < 0 || index > MAX_BUNKER_CHAIN_OWNER_INDEX)
    throw new Error("Invalid Bunker owner index");
  return [44, 60, BUNKER_ACCOUNT_NAMESPACE, BUNKER_CHAIN_DERIVATION_VERSION,
    Math.floor(chainId / COMPONENT_BASE), chainId % COMPONENT_BASE, index];
}

export function bunkerChainOwnerPath(chainId: number, index: number): string {
  return `m/${bunkerOwnerPathComponents(chainId, index).map(part => `${part}'`).join("/")}`;
}
