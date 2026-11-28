import { mnemonicToSeedSync } from "@scure/bip39";
import { HDKey } from "@scure/bip32";
import { bytesToHex, type Hex } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import { isValidMnemonic } from "../mnemonic/derivation";
import { bunkerOwnerPathComponents } from "./chainIdentity";

/** Trusted background call-stack only. Reuses the ordinary mnemonic policy. */
function visitOwnerNode<T>(phrase: string, chainId: number, index: number, use: (node: HDKey) => T): T {
  // Validate public selectors before the relatively expensive seed KDF.
  const components = bunkerOwnerPathComponents(chainId, index);
  if (typeof phrase !== "string" || phrase.length > 512 ||
      phrase !== phrase.trim().toLowerCase() || !isValidMnemonic(phrase))
    throw new Error("Invalid source seed phrase");
  const seed = mnemonicToSeedSync(phrase);
  let root: HDKey | undefined;
  let node: HDKey | undefined;
  try {
    root = HDKey.fromMasterSeed(seed);
    node = root;
    for (const component of components) {
      const next: HDKey = node!.deriveChild(0x80000000 + component);
      if (node !== root) node!.wipePrivateData();
      node = next;
    }
    if (!node?.privateKey) throw new Error("Bunker owner derivation failed");
    return use(node);
  } finally {
    node?.wipePrivateData();
    root?.wipePrivateData();
    seed.fill(0);
  }
}

export function deriveBunkerChainOwner(phrase: string, chainId: number, index: number): Hex {
  return visitOwnerNode(phrase, chainId, index, node =>
    privateKeyToAddress(bytesToHex(node.privateKey!)).toLowerCase() as Hex);
}

/** No key cache or message route; mutable HD/seed buffers are wiped before awaiting use. */
export async function withBunkerChainOwnerKey<T>(
  phrase: string, chainId: number, index: number, use: (key: Hex) => Promise<T>,
): Promise<T> {
  return visitOwnerNode(phrase, chainId, index, node => use(bytesToHex(node.privateKey!)));
}
