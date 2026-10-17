import { createPublicClient, getAddress, keccak256, type PublicClient } from "viem";
import { getStoredRpcUrl } from "@/lib/chains";
import { RPC_URLS } from "@/constants/chainRegistry";
import { secureHttpTransport } from "../network/rpcClient";
import pins from "./deployments.json";
export const BUNKER_CHAIN_ID = 11155111;
export const BUNKER_CONFIRMATIONS = 3n;
export const BUNKER_PINS = pins;
export async function bunkerClient(): Promise<PublicClient> {
  const rpc = await getStoredRpcUrl(BUNKER_CHAIN_ID) ?? RPC_URLS[BUNKER_CHAIN_ID];
  return createPublicClient({ cacheTime: 0, transport: secureHttpTransport(rpc, { timeout: 15000, retryCount: 0 }) });
}
export async function verifyBunkerInfrastructure(client: PublicClient) {
  const [chainId, block] = await Promise.all([client.getChainId(), client.getBlockNumber()]);
  if (chainId !== BUNKER_CHAIN_ID) throw new Error("Bunker RPC is not on Sepolia");
  await Promise.all([pins.factory, pins.singleton, pins.multiSend].map(async (pin) => {
    const code = await client.getCode({ address: getAddress(pin.address), blockNumber: block });
    if (!code || keccak256(code) !== pin.codeHash) throw new Error("Bunker Safe infrastructure could not be verified");
  }));
  return block;
}
