import { hasBunkerModule } from "./modulePolicy";
import { WALLET_SECRET_OPERATION_LOCK_KEY, withStorageLock } from "../storageLock";
import type { BunkerAccess } from "./access";
import { getAddress, zeroAddress, type PublicClient } from "viem";
import { verifySafeOnchainState } from "../safe/onchainState";
import { BUNKER_PINS, verifyBunkerInfrastructure } from "./network";
import { deriveBunkerOwner } from "./derivation";
import { withBunkerDraftSeed } from "./crypto";
import { loadBunkerDraftVault } from "./repository";
import type { BunkerState } from "./types";

export async function bunkerEntry(id: string) {
  const entry = (await loadBunkerDraftVault()).entries.find((e) => e.header.id === id);
  if (!entry) throw new Error("Bunker seed is missing"); return entry;
}
export async function readBunkerLive(state: BunkerState, client: PublicClient, blockNumber?: bigint) {
  await verifyBunkerInfrastructure(client, state.chainId);
  if (state.plan.verifiedBlock && (await client.getBlock({ blockNumber: BigInt(state.plan.verifiedBlock.number) })).hash !== state.plan.verifiedBlock.hash) throw new Error("Chain reorganization detected. Recovery required.");
  const live = await verifySafeOnchainState({ chainId: state.chainId, safeAddress: state.plan.address, client, blockNumber });
  if (live.version !== "1.4.1" || live.singleton !== BUNKER_PINS.singleton.address.toLowerCase() ||
      live.threshold !== 1 || live.owners.length !== 1 || !hasBunkerModule(live.modules, live.fallbackHandler) || live.guard !== zeroAddress || live.contractOwners.length) throw new Error("Bunker Safe configuration changed. Recovery required.");
  return live;
}
export async function verifyBunkerOwner(state: BunkerState, key: CryptoKey, client: PublicClient, reservedNextIndex?: number, access?: BunkerAccess) {
  const live = await readBunkerLive(state, client);
  const entry = await bunkerEntry(state.id);
  const derive = async () => {
    const owners = await withBunkerDraftSeed(entry, access ? access() : key, async (seed) => {
      let nextIndex = state.nextIndex;
      if (reservedNextIndex !== undefined) {
        if (!state.operations.some((o) => o.signature && o.review?.nextIndex === reservedNextIndex && o.review.ownerIndex === state.ownerIndex)) throw new Error("Unbound reserved successor");
        nextIndex = reservedNextIndex;
      } else while (state.usedOwners.includes(deriveBunkerOwner(seed, state.chainId, nextIndex))) nextIndex++;
      return { owner: deriveBunkerOwner(seed, state.chainId, state.ownerIndex), next: deriveBunkerOwner(seed, state.chainId, nextIndex), nextIndex };
    });
    access?.(); return owners;
  };
  const owners = access ? await withStorageLock(WALLET_SECRET_OPERATION_LOCK_KEY, derive) : await derive();
  if (live.owners[0] !== owners.owner || state.nextIndex <= state.ownerIndex) throw new Error("Bunker owner changed. Reconcile before signing.");
  await Promise.all([owners.owner, owners.next].map(async (address) => {
    const [code, nonce] = await Promise.all([client.getCode({ address: getAddress(address) }), client.getTransactionCount({ address: getAddress(address) })]);
    if (code && code !== "0x") throw new Error("Bunker owners must be plain addresses");
    if (nonce !== 0) throw new Error("Bunker owner address has been used as a transaction sender");
  }));
  return { live, ...owners };
}
