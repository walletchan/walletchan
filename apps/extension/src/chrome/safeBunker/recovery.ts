import { deriveBunkerOwner } from "./derivation";
import { withBunkerDraftSeed } from "./crypto";
import { getAddress, type Hex, type PublicClient } from "viem";
import { SAFE_READ_ABI } from "../safe/onchainState";
import { WALLET_SECRET_OPERATION_LOCK_KEY, withStorageLock } from "../storageLock";
import { captureBunkerAccess } from "./access";
import { bunkerEntry, readBunkerLive } from "./live";
import { activateBunker, BunkerOwnerMismatchError } from "./deployment";
import { readBunkerState, writeBunkerState } from "./stateRepository";
import { queueBunkerOperation } from "./operations";

export async function continueBunkerRecovery(id: string, client: PublicClient) {
  const current = captureBunkerAccess(); current();
  return withStorageLock(`bunker:${id}`, () => withStorageLock(WALLET_SECRET_OPERATION_LOCK_KEY, async () => {
    const state = await readBunkerState(id, current()); if (!state?.recovery) throw new Error("No Bunker recovery scan is pending");
    const r = state.recovery;
    // One cheap current-owner read per bounded local derivation page. No event history.
    const owners = await client.readContract({ address: state.plan.address, abi: SAFE_READ_ABI, functionName: "getOwners" });
    if (owners.length !== 1) throw new Error("Bunker Safe configuration changed. Recovery required.");
    const owner = getAddress(owners[0]).toLowerCase() as Hex;
    if (r.targetOwner !== owner) {
      // Also upgrades legacy in-progress history scans without discarding local exposure.
      r.targetOwner = owner; r.deriveIndex = 0; r.matchedIndex = null;
    }
    await withBunkerDraftSeed(await bunkerEntry(id), current(), (seed) => {
      const end = Math.min(r.deriveIndex + 64, 0x7fffffff);
      while (r.deriveIndex < end && r.matchedIndex === null) {
        const index = r.deriveIndex++;
        if (deriveBunkerOwner(seed, state.chainId, index) === owner) r.matchedIndex = index;
      }
    });
    current();
    if (r.matchedIndex !== null) {
      state.usedOwners = [...new Set([...state.usedOwners, ...r.usedOwners, owner])];
      state.ownerIndex = r.matchedIndex;
      state.nextIndex = Math.max(state.nextIndex, state.ownerIndex + 1);
      state.recovery = null;
      try {
        // Revalidate full live configuration and the matched owner before activation.
        await activateBunker(state, client, current);
      } catch (error) {
        if (!(error instanceof BunkerOwnerMismatchError)) throw error;
        // The owner moved while deriving. Repin it on the next page, without logs.
        state.recovery = r; delete r.targetOwner; r.deriveIndex = 0; r.matchedIndex = null;
        await writeBunkerState(state, current);
      }
    } else {
      if (r.deriveIndex === 0x7fffffff) throw new Error("Owner derivation range exhausted; recovery data is preserved");
      await writeBunkerState(state, current);
    }
    return state;
  }));
}
export async function createBunkerRecoveryOperation(accountId: string, client: PublicClient) {
  const current = captureBunkerAccess(); current();
  const { stateForAccount } = await import("./operations");
  const initial = await stateForAccount(accountId);
  const scanning = await withStorageLock(`bunker:${initial.id}`, () => withStorageLock(WALLET_SECRET_OPERATION_LOCK_KEY, async () => {
    const state = await stateForAccount(accountId);
    if (state.recovery) return true;
    const live = await readBunkerLive(state, client);
    const expected = await withBunkerDraftSeed(await bunkerEntry(state.id), current(), (seed) => deriveBunkerOwner(seed, state.chainId, state.ownerIndex));
    if (live.owners[0] === expected) return false;
    state.exposureUnknown = true;
    state.recovery = { targetOwner: live.owners[0], scanBlock: state.plan.fromBlock, targetBlock: live.verifiedAtBlock, deriveIndex: 0, matchedIndex: null, usedOwners: [...state.usedOwners] };
    await writeBunkerState(state, current); return true;
  }));
  if (scanning) return { scanning: true };
  const id = crypto.randomUUID();
  return queueBunkerOperation({ id, accountId, chainId: initial.chainId, calls: [], recovery: true,
    routes: [{ kind: "wallet", origin: "Bunker recovery", requestId: id }] });
}
