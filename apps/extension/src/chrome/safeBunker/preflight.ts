import { getAddress, zeroAddress, type Hex, type PublicClient } from "viem";
import { SAFE_READ_ABI, SAFE_SINGLETON_SLOT, GUARD_STORAGE_SLOT, FALLBACK_HANDLER_STORAGE_SLOT, configurationEpoch } from "../safe/onchainState";
import { BUNKER_CHAIN_ID, BUNKER_PINS } from "./network";
import { bunkerStep } from "./errors";
import type { BunkerReview, BunkerState } from "./types";

const sentinel = "0x0000000000000000000000000000000000000001";
const addressFromWord = (word: Hex | undefined) => getAddress(`0x${(word ?? "0x").slice(2).padStart(64, "0").slice(-40)}`).toLowerCase() as Hex;

/** One final check of mutable authority. Canonical deployment code is verified in review. */
export async function preflightBunkerExecution(state: BunkerState, review: BunkerReview, owner: Hex, next: Hex, data: Hex, client: PublicClient) {
  const blockNumber = await bunkerStep("authority", () => client.getBlockNumber());
  const contract = { address: state.plan.address, abi: SAFE_READ_ABI, blockNumber } as const;
  const authority = bunkerStep("authority", async () => {
    const [chainId, version, owners, threshold, nonce, modules, singletonWord, guardWord, fallbackWord, ownerStates] = await Promise.all([
      client.getChainId(),
      client.readContract({ ...contract, functionName: "VERSION" }),
      client.readContract({ ...contract, functionName: "getOwners" }),
      client.readContract({ ...contract, functionName: "getThreshold" }),
      client.readContract({ ...contract, functionName: "nonce" }),
      client.readContract({ ...contract, functionName: "getModulesPaginated", args: [sentinel, 1n] }),
      client.getStorageAt({ address: state.plan.address, slot: SAFE_SINGLETON_SLOT, blockNumber }),
      client.getStorageAt({ address: state.plan.address, slot: GUARD_STORAGE_SLOT, blockNumber }),
      client.getStorageAt({ address: state.plan.address, slot: FALLBACK_HANDLER_STORAGE_SLOT, blockNumber }),
      Promise.all([owner, next].map(async (address) => Promise.all([
        client.getCode({ address, blockNumber }), client.getTransactionCount({ address, blockNumber }),
      ]))),
    ]);
    if (chainId !== BUNKER_CHAIN_ID) throw new Error("Bunker RPC is not on Sepolia");
    const singleton = addressFromWord(singletonWord), guard = addressFromWord(guardWord), fallbackHandler = addressFromWord(fallbackWord);
    if (version !== "1.4.1" || singleton !== BUNKER_PINS.singleton.address.toLowerCase() || threshold !== 1n || owners.length !== 1 ||
      modules[0].length || modules[1].toLowerCase() !== sentinel || guard !== zeroAddress || fallbackHandler !== zeroAddress) throw new Error("Bunker Safe configuration changed. Recovery required.");
    if (owners[0].toLowerCase() !== owner || nonce !== BigInt(review.nonce)) throw new Error("Bunker owner or nonce changed");
    for (const [code, count] of ownerStates) {
      if (code && code !== "0x") throw new Error("Bunker owners must be plain addresses");
      if (count !== 0) throw new Error("Bunker owner address has been used as a transaction sender");
    }
    const epoch = configurationEpoch({ chainId, safeAddress: state.plan.address, singleton, version, owners: [owner], contractOwners: [], threshold: 1, modules: [], guard, fallbackHandler });
    if (epoch !== review.configEpoch) throw new Error("Bunker authority changed");
  });
  await Promise.all([
    authority,
    bunkerStep("balance", async () => {
      if (await client.getBalance({ address: review.payerAddress, blockNumber }) < BigInt(review.maxFee)) throw new Error("Gas payer has insufficient Sepolia ETH");
    }),
    // Simulate once with the actual signature, payer and reviewed gas ceiling.
    bunkerStep("simulation", () => client.call({ account: review.payerAddress, to: state.plan.address, data, gas: BigInt(review.gas.gasLimit), blockNumber })),
  ]);
  return blockNumber;
}
