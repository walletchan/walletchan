import { createPublicClient, defineChain, getAddress, keccak256, type PublicClient } from "viem";
import { getStoredResolvedChainById, getResolvedChains, getStoredNetworksInfo } from "@/lib/chains";
import { secureHttpTransport } from "../network/rpcClient";
import pins from "./deployments.json";
import { assertBunkerChainId } from "./chainIdentity";
export const BUNKER_CONFIRMATIONS = 3n;
// One frozen canonical EVM 1.4.1 profile; exact code is verified on every target chain.
export const BUNKER_PINS = pins;
export async function bunkerNetworks() {
  return getResolvedChains(await getStoredNetworksInfo()).filter(c => c.chainId !== 324 && !c.hidden);
}
export async function bunkerClient(chainId: number): Promise<PublicClient> {
  assertBunkerChainId(chainId);
  const info = await getStoredResolvedChainById(chainId);
  if (!info || chainId === 324) throw new Error("Unsupported Bunker network");
  const chain = defineChain({ id: chainId, name: info.name, nativeCurrency: info.nativeCurrency, rpcUrls: { default: { http: [info.rpcUrl] } } });
  return createPublicClient({ chain, cacheTime: 0, transport: secureHttpTransport(info.rpcUrl, { timeout: 15000, retryCount: 0 }) });
}
export async function verifyBunkerInfrastructure(client: PublicClient, expectedChainId: number) {
  assertBunkerChainId(expectedChainId);
  const [chainId, block] = await Promise.all([client.getChainId(), client.getBlockNumber()]);
  if (chainId !== expectedChainId || chainId === 324) throw new Error("Bunker RPC chain mismatch");
  await Promise.all([pins.factory, pins.singleton, pins.multiSend].map(async pin => {
    const code = await client.getCode({ address: getAddress(pin.address), blockNumber: block });
    if (!code || keccak256(code) !== pin.codeHash) throw new Error("Bunker Safe infrastructure could not be verified");
  }));
  return block;
}
