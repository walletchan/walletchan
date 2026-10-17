import { decodeFunctionData, getAddress, type Hex, type PublicClient } from "viem";
import { SAFE_READ_ABI } from "../safe/onchainState";
import { getAccounts } from "../accountStorage";
import { WALLET_SECRET_OPERATION_LOCK_KEY, withStorageLock } from "../storageLock";
import { captureBunkerAccess } from "./access";
import { assertBunkerSeed, deriveBunkerOwner } from "./derivation";
import { withBunkerDraftSeed, encryptBunkerDraft } from "./crypto";
import { BUNKER_DRAFT_VAULT_KEY, assertBunkerDraftId } from "./record";
import { loadBunkerDraftVault } from "./repository";
import { bunkerEntry, readBunkerLive } from "./live";
import { assertBunkerCreationReceipt, bunkerInitializer, FACTORY_ABI, predictBunker, activateBunker, BunkerOwnerMismatchError } from "./deployment";
import { BUNKER_CHAIN_ID, BUNKER_CONFIRMATIONS, BUNKER_PINS, verifyBunkerInfrastructure } from "./network";
import { readBunkerState, writeBunkerState } from "./stateRepository";
import type { BunkerState } from "./types";
import { queueBunkerOperation } from "./operations";

export async function restoreBunker(input: { id: string; seed: string; address: Hex; deploymentHash: Hex }, client: PublicClient) {
  const current = captureBunkerAccess(true); current();
  return withStorageLock(WALLET_SECRET_OPERATION_LOCK_KEY, async () => {
    assertBunkerDraftId(input.id);
    assertBunkerSeed(input.seed); await verifyBunkerInfrastructure(client);
    const existing = await readBunkerState(input.id, current()); if (existing) return existing;
    const tx = await client.getTransaction({ hash: input.deploymentHash });
    const receipt = await client.getTransactionReceipt({ hash: input.deploymentHash });
    if (tx.to?.toLowerCase() !== BUNKER_PINS.factory.address.toLowerCase() || receipt.status !== "success" || tx.input.length > 8192) throw new Error("Use the original Safe factory deployment transaction");
    const decoded = decodeFunctionData({ abi: FACTORY_ABI, data: tx.input });
    if (decoded.functionName !== "createProxyWithNonce") throw new Error("Unsupported Safe deployment");
    const [singleton, initializer, salt] = decoded.args;
    const firstOwner = deriveBunkerOwner(input.seed, 0);
    if (singleton.toLowerCase() !== BUNKER_PINS.singleton.address.toLowerCase() || initializer.toLowerCase() !== bunkerInitializer(firstOwner).toLowerCase() ||
      (await predictBunker(client, initializer, salt.toString())) !== input.address.toLowerCase()) throw new Error("Seed or Safe deployment does not match");
    assertBunkerCreationReceipt(receipt, input.address);
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    const head = await client.getBlockNumber();
    if (block.hash !== receipt.blockHash || head < receipt.blockNumber + BUNKER_CONFIRMATIONS - 1n) throw new Error("Wait for deployment confirmations");
    const vault = await loadBunkerDraftVault(); if (vault.entries.length >= 100 || vault.entries.some((e) => e.header.id === input.id)) throw new Error("Bunker identity already exists");
    if ((await getAccounts()).some((a) => a.address.toLowerCase() === input.address.toLowerCase())) throw new Error("Bunker address is already imported");
    const entry = await encryptBunkerDraft({ id: input.id, name: "Restored Bunker", chainId: BUNKER_CHAIN_ID,
      derivationVersion: 1, firstOwner, createdAt: Date.now() }, input.seed, current());
    const state: BunkerState = { version: 1, id: input.id, accountId: `bunker:${input.id.slice(13)}`,
      plan: { address: getAddress(input.address).toLowerCase() as Hex, initializer, salt: salt.toString(), fromBlock: receipt.blockNumber.toString(), deploymentHash: input.deploymentHash },
      backupConfirmed: true, activated: false, archived: false, ownerIndex: 0, nextIndex: 1, exposureUnknown: true, usedOwners: [firstOwner], defaultPayer: null, operations: [],
      recovery: { scanBlock: receipt.blockNumber.toString(), targetBlock: (head - BUNKER_CONFIRMATIONS + 1n).toString(), deriveIndex: 0, matchedIndex: null, usedOwners: [firstOwner] } };
    const live = await readBunkerLive(state, client); current();
    state.recovery!.targetOwner = live.owners[0];
    await writeBunkerState(state, current, { [BUNKER_DRAFT_VAULT_KEY]: { version: 1, entries: [...vault.entries, entry] } }, entry); return state;
  });
}
export async function continueBunkerRecovery(id: string, client: PublicClient) {
  const current = captureBunkerAccess(true); current();
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
        if (deriveBunkerOwner(seed, index) === owner) r.matchedIndex = index;
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
  const current = captureBunkerAccess(true); current();
  const { stateForAccount } = await import("./operations");
  const initial = await stateForAccount(accountId);
  const scanning = await withStorageLock(`bunker:${initial.id}`, () => withStorageLock(WALLET_SECRET_OPERATION_LOCK_KEY, async () => {
    const state = await stateForAccount(accountId);
    if (state.recovery) return true;
    const live = await readBunkerLive(state, client);
    const expected = await withBunkerDraftSeed(await bunkerEntry(state.id), current(), (seed) => deriveBunkerOwner(seed, state.ownerIndex));
    if (live.owners[0] === expected) return false;
    state.exposureUnknown = true;
    state.recovery = { targetOwner: live.owners[0], scanBlock: state.plan.fromBlock, targetBlock: live.verifiedAtBlock, deriveIndex: 0, matchedIndex: null, usedOwners: [...state.usedOwners] };
    await writeBunkerState(state, current); return true;
  }));
  if (scanning) return { scanning: true };
  const id = crypto.randomUUID();
  return queueBunkerOperation({ id, accountId, chainId: BUNKER_CHAIN_ID, calls: [], recovery: true,
    routes: [{ kind: "wallet", origin: "Bunker recovery", requestId: id }] });
}
