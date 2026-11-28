import { type Hex, type PublicClient } from "viem";
import { getAccounts } from "../accountStorage";
import { getAuthCeremonyEpoch } from "../authTransition";
import { captureBunkerAccess } from "./access";
import { createBunkerDraft } from "./drafts";
import { prepareBunkerDeployment, activateBunker } from "./deployment";
import { bunkerClient, BUNKER_CONFIRMATIONS } from "./network";
import { readBunkerState } from "./stateRepository";
import { readBunkerLive, bunkerEntry } from "./live";
import { withBunkerDraftSeed } from "./crypto";
import { withBunkerSourcePhrase } from "./sources";
import { buildBunkerDeploymentIdentity, BUNKER_FACTORY_ABI } from "./deploymentIdentity";
import { BUNKER_PINS, verifyBunkerInfrastructure } from "./network";
import type { BunkerState } from "./types";
import { getStoredChainName } from "@/lib/chains";
import { deriveBunkerOwner } from "./derivation";
import { WALLET_SECRET_OPERATION_LOCK_KEY, withStorageLock } from "../storageLock";
export type BunkerDiscoveryStatus = "absent" | "deployed" | "local" | "pending" | "searching";
export interface BunkerDiscoveryResult { chainId: number; address: Hex; status: BunkerDiscoveryStatus }
interface Search { owner: Hex; next: number; matched?: number; epoch: string; expires: number }
const searches = new Map<string, Search>();

/** Each call is one bounded chain probe/64-owner page; no genesis scan or signed RPC. */
export async function discoverBunker(seedGroupId: string, chainId: number, client?: PublicClient): Promise<BunkerDiscoveryResult> {
  const current = captureBunkerAccess(), epoch = getAuthCeremonyEpoch();
  current();
  client ??= await bunkerClient(chainId);
  const block = await verifyBunkerInfrastructure(client, chainId); current();
  const firstOwner = await withBunkerSourcePhrase(seedGroupId, phrase => deriveBunkerOwner(phrase, chainId, 0));
  const id = `bunker-source:${chainId}:${firstOwner}`;
  const codeBytes = await client.readContract({ address: BUNKER_PINS.factory.address as Hex, abi: BUNKER_FACTORY_ABI, functionName: "proxyCreationCode" });
  const identity = buildBunkerDeploymentIdentity({ chainId, factory: BUNKER_PINS.factory.address as Hex,
    singleton: BUNKER_PINS.singleton.address as Hex, proxyCreationCode: codeBytes }, firstOwner);
  const stored = await readBunkerState(id, current());
  const state: BunkerState = stored ?? {
    version: 2, id, chainId, chainName: await getStoredChainName(chainId), seedGroupId, accountId: identity.accountId,
    plan: { address: identity.address, initializer: identity.initializer, salt: identity.salt, fromBlock: block.toString() },
    activated: false, archived: false, ownerIndex: 0, nextIndex: 1, exposureUnknown: false,
    usedOwners: [], defaultPayer: null, operations: [], recovery: null,
  };
  if (state.plan.address !== identity.address || state.plan.initializer !== identity.initializer || state.plan.salt !== identity.salt)
    throw new Error("Bunker discovery changed. Retry the network check.");
  current();
  const local = (await getAccounts()).find(a => a.type === "safeBunker" && a.chainId === chainId && a.address.toLowerCase() === state.plan.address);
  if (state.plan.deploymentHash && !state.activated) return { chainId, address: state.plan.address, status: "pending" };
  const head = await client.getBlockNumber();
  const blockNumber = head >= BUNKER_CONFIRMATIONS - 1n ? head - BUNKER_CONFIRMATIONS + 1n : 0n;
  const code = await client.getCode({ address: state.plan.address, blockNumber }); current();
  if (!code || code === "0x") {
    const latest = await client.getCode({ address: state.plan.address }); current();
    if (latest && latest !== "0x") return { chainId, address: state.plan.address, status: "pending" };
    if (local || state.activated) throw new Error("Bunker discovery changed. Retry the network check.");
    return { chainId, address: state.plan.address, status: "absent" };
  }
  const live = await readBunkerLive(state, client, blockNumber); current();
  let search = searches.get(id);
  if (!search || search.owner !== live.owners[0] || search.epoch !== epoch || search.expires < Date.now()) {
    search = { owner: live.owners[0], next: 0, epoch, expires: Date.now() + 10 * 60000 };
    if (searches.size >= 100) searches.delete(searches.keys().next().value!);
    searches.set(id, search);
  }
  if (search.matched === undefined) {
    const scan = search;
    await withBunkerSourcePhrase(seedGroupId, root => {
      // Existing verified index is a hint, never a nonce-derived guess.
      if (deriveBunkerOwner(root, chainId, state.ownerIndex) === scan.owner) scan.matched = state.ownerIndex;
      const end = Math.min(scan.next + 64, 0x80000000);
      while (scan.matched === undefined && scan.next < end) {
        const index = scan.next++;
        if (deriveBunkerOwner(root, chainId, index) === scan.owner) scan.matched = index;
      }
    });
    if (search.matched === undefined && search.next >= 0x80000000) throw new Error("Bunker owner derivation range exhausted");
  }
  current();
  return { chainId, address: state.plan.address, status: search.matched === undefined ? "searching" : local ? "local" : "deployed" };
}

/** Rechecks each selected deployment. No transaction, hidden recovery operation or auto-add. */
export async function addExistingBunker(seedGroupId: string, chainId: number, client?: PublicClient) {
  const current = captureBunkerAccess(); client ??= await bunkerClient(chainId);
  const result = await discoverBunker(seedGroupId, chainId, client); current();
  if (!["deployed", "local"].includes(result.status)) throw new Error("Bunker discovery changed. Retry the network check.");
  const entry = await createBunkerDraft(seedGroupId, chainId);
  const match = searches.get(entry.id)?.matched;
  if (match === undefined) throw new Error("Bunker discovery changed. Retry the network check.");
  const prepared = await prepareBunkerDeployment(entry.id, client); current();
  if (prepared.plan.address !== result.address) throw new Error("Bunker discovery changed. Retry the network check.");
  return withStorageLock(`bunker:${entry.id}`, () => withStorageLock(WALLET_SECRET_OPERATION_LOCK_KEY, async () => {
    const state = await readBunkerState(entry.id, current());
    if (!state) throw new Error("Bunker journal is missing");
    const head = await client!.getBlockNumber();
    const block = await client!.getBlock({ blockNumber: head >= BUNKER_CONFIRMATIONS - 1n ? head - BUNKER_CONFIRMATIONS + 1n : 0n });
    if (!block.hash) throw new Error("Bunker discovery changed. Retry the network check.");
    const live = await readBunkerLive(state, client!, block.number); current();
    const owner = await withBunkerDraftSeed(await bunkerEntry(entry.id), current(), root => deriveBunkerOwner(root, chainId, match));
    if (live.owners[0] !== owner) throw new Error("Bunker discovery changed. Retry the network check.");
    state.ownerIndex = match; state.nextIndex = Math.max(state.nextIndex, match + 1);
    state.usedOwners = [...new Set([...state.usedOwners, owner])];
    state.archived = false;
    state.plan.verifiedBlock = { number: block.number.toString(), hash: block.hash };
    // Reimport retains known exposure/operations. Mere restoration creates no new recovery requirement.
    await activateBunker(state, client!, current);
    return state.accountId;
  }));
}
