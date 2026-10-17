import { publishBunkerDeployment, ensureBunkerDeploymentHistory } from "./deploymentPublication";
import { broadcastBunkerBytes } from "./broadcast";
import { TransactionReceiptNotFoundError, concatHex, decodeEventLog, decodeFunctionData, encodeAbiParameters, encodeFunctionData, getCreate2Address, keccak256, parseAbi, stringToHex, zeroAddress, type Hex, type PublicClient, type TransactionReceipt } from "viem";
import { getAccounts, setActiveAccountId } from "../accountStorage";
import { BUNKER_CHAIN_ID, BUNKER_PINS, BUNKER_CONFIRMATIONS, verifyBunkerInfrastructure } from "./network";
import { captureBunkerAccess } from "./access";
import { readBunkerState, writeBunkerState } from "./stateRepository";
import { bunkerEntry, readBunkerLive } from "./live";
import { submitBunkerOuter, bunkerPayer } from "./payer";
import { WALLET_SECRET_OPERATION_LOCK_KEY, withStorageLock } from "../storageLock";
import type { GasOverrides } from "../transactions/localExecution";
import type { BunkerPlan, BunkerState } from "./types";
import { withBunkerDraftSeed } from "./crypto";
import { deriveBunkerOwner } from "./derivation";
import { validateSafeGasOverrides } from "../safe/executionGas";

export const FACTORY_ABI = parseAbi(["function createProxyWithNonce(address _singleton,bytes initializer,uint256 saltNonce) returns(address)", "function proxyCreationCode() view returns(bytes)", "event ProxyCreation(address indexed proxy,address singleton)"]);
export const SETUP_ABI = parseAbi(["function setup(address[] owners,uint256 threshold,address to,bytes data,address fallbackHandler,address paymentToken,uint256 payment,address paymentReceiver)"]);
export function bunkerInitializer(owner: Hex) {
  return encodeFunctionData({ abi: SETUP_ABI, functionName: "setup", args: [[owner], 1n, zeroAddress, "0x", zeroAddress, zeroAddress, 0n, zeroAddress] });
}
export async function predictBunker(client: PublicClient, initializer: Hex, salt: string): Promise<Hex> {
  const code = await client.readContract({ address: BUNKER_PINS.factory.address as Hex, abi: FACTORY_ABI, functionName: "proxyCreationCode" });
  if (code.length > 8192) throw new Error("Invalid Safe proxy creation code");
  return getCreate2Address({ from: BUNKER_PINS.factory.address as Hex,
    salt: keccak256(concatHex([keccak256(initializer), encodeAbiParameters([{ type: "uint256" }], [BigInt(salt)])])),
    bytecode: concatHex([code, encodeAbiParameters([{ type: "uint256" }], [BigInt(BUNKER_PINS.singleton.address)])]) }).toLowerCase() as Hex;
}
export function deploymentData(plan: BunkerPlan) { return encodeFunctionData({ abi: FACTORY_ABI, functionName: "createProxyWithNonce", args: [BUNKER_PINS.singleton.address as Hex, plan.initializer, BigInt(plan.salt)] }); }
export async function prepareBunkerDeployment(id: string, client: PublicClient): Promise<BunkerState> {
  const current = captureBunkerAccess(true); current();
  return withStorageLock(WALLET_SECRET_OPERATION_LOCK_KEY, async () => {
    const old = await readBunkerState(id, current()); if (old) return old;
    const block = await verifyBunkerInfrastructure(client); const entry = await bunkerEntry(id);
    const initializer = bunkerInitializer(entry.header.firstOwner);
    const salt = BigInt(keccak256(stringToHex(`WalletChan.SafeBunker.client-rotation.v1:${BUNKER_CHAIN_ID}:${id}`))).toString();
    const address = await predictBunker(client, initializer, salt); current();
    const state: BunkerState = { version: 1, id, accountId: `bunker:${id.slice(13)}`, plan: { address, initializer, salt, fromBlock: block.toString() },
      activated: false, archived: false, ownerIndex: 0, nextIndex: 1, exposureUnknown: false, usedOwners: [entry.header.firstOwner], defaultPayer: null, operations: [], recovery: null };
    await writeBunkerState(state, current); return state;
  });
}
export async function estimateBunkerDeployment(state: BunkerState, payerId: string, client: PublicClient) {
  await verifyBunkerInfrastructure(client); const payer = await bunkerPayer(payerId);
  const data = deploymentData(state.plan);
  const gas = await client.estimateGas({ account: payer.address as Hex, to: BUNKER_PINS.factory.address as Hex, data });
  const fees = await client.estimateFeesPerGas();
  const overrides = { gasLimit: (gas * 12n / 10n).toString(), maxFeePerGas: fees.maxFeePerGas!.toString(), maxPriorityFeePerGas: fees.maxPriorityFeePerGas!.toString() };
  if (await client.getBalance({ address: payer.address as Hex }) < BigInt(overrides.gasLimit) * BigInt(overrides.maxFeePerGas)) throw new Error("Gas payer has insufficient Sepolia ETH");
  return { gas: overrides, payerAddress: payer.address.toLowerCase() as Hex };
}
export class BunkerOwnerMismatchError extends Error {
  constructor() { super("Deployment owner does not match Bunker seed"); }
}
export async function activateBunker(state: BunkerState, client: PublicClient, current: () => CryptoKey) {
  const live = await readBunkerLive(state, client);
  const entry = await bunkerEntry(state.id);
  const owner = await withBunkerDraftSeed(entry, current(), (seed) => deriveBunkerOwner(seed, state.ownerIndex));
  if (live.owners[0] !== owner) throw new BunkerOwnerMismatchError();
  const accounts = await getAccounts();
  const existing = accounts.find((a) => a.id === state.accountId);
  if (existing && (existing.type !== "safeBunker" || existing.seedVaultId !== state.id || existing.address !== state.plan.address)) throw new Error("Bunker account identity collision");
  if (accounts.some((a) => a.id !== state.accountId && a.address.toLowerCase() === state.plan.address)) throw new Error("Safe address is already present in this wallet");
  const confirmed = existing ? { ...existing } : null;
  if (confirmed?.type === "safeBunker") delete confirmed.deploymentPending;
  state.activated = true; state.archived = false;
  await writeBunkerState(state, current, { accounts: confirmed ? accounts.map(a => a.id === state.accountId ? confirmed : a) : [...accounts, { id: state.accountId, type: "safeBunker", address: state.plan.address,
    displayName: entry.header.name, ...(state.backupConfirmed ? {} : { backupPending: true }), chainId: BUNKER_CHAIN_ID, seedVaultId: state.id, derivationVersion: 1, createdAt: entry.header.createdAt }] });
  await ensureBunkerDeploymentHistory(state); current();
  if (!existing) { await setActiveAccountId(state.accountId); current(); }
  chrome.runtime.sendMessage({ type: "accountsUpdated" }).catch(() => {});
}
export function assertBunkerCreationReceipt(receipt: TransactionReceipt, address: Hex) {
  const creation = receipt.logs.filter((l) => l.address.toLowerCase() === BUNKER_PINS.factory.address.toLowerCase()).some((log) => {
    try { const e = decodeEventLog({ abi: FACTORY_ABI, topics: log.topics, data: log.data });
      return e.eventName === "ProxyCreation" && e.args.proxy.toLowerCase() === address.toLowerCase() && e.args.singleton.toLowerCase() === BUNKER_PINS.singleton.address.toLowerCase();
    } catch { return false; }
  });
  if (!creation) throw new Error("Bunker creation event is missing");
}
export async function verifyBunkerDeployment(state: BunkerState, client: PublicClient, current: () => CryptoKey): Promise<boolean> {
  const hash = state.plan.deploymentHash; if (!hash) return false;
  let receipt: TransactionReceipt;
  try { receipt = await client.getTransactionReceipt({ hash }); }
  catch (error) { if (error instanceof TransactionReceiptNotFoundError) return false; throw error; }
  if (receipt.status !== "success") throw new Error("Safe deployment reverted. Retry with the same identity.");
  const tx = await client.getTransaction({ hash });
  if (tx.to?.toLowerCase() !== BUNKER_PINS.factory.address.toLowerCase() || tx.input.toLowerCase() !== deploymentData(state.plan).toLowerCase() || tx.value !== 0n) throw new Error("Deployment receipt does not match this Bunker");
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  if (block.hash !== receipt.blockHash || (await client.getBlockNumber()) < receipt.blockNumber + BUNKER_CONFIRMATIONS - 1n) return false;
  assertBunkerCreationReceipt(receipt, state.plan.address);
  await activateBunker(state, client, current); return true;
}
export async function deployBunker(id: string, payerId: string, gas: GasOverrides, remember: boolean, client: PublicClient) {
  const current = captureBunkerAccess(true); current();
  // Claim across hardware and local submission; local signer owns the global secret-operation lock.
  return withStorageLock(`bunker:${id}`, async () => {
    let state = await readBunkerState(id, current()); if (!state || state.activated) throw new Error("Review Bunker deployment first");
    validateSafeGasOverrides(gas); const payer = await bunkerPayer(payerId); const address = payer.address.toLowerCase() as Hex;
    if (state.plan.deploymentHash) {
      try { if (await verifyBunkerDeployment(state, client, current)) return state; }
      catch (e) { if (!(e instanceof Error) || e.message !== "Safe deployment reverted. Retry with the same identity.") throw e; }
      const receipt = await client.getTransactionReceipt({ hash: state.plan.deploymentHash }).catch(() => null);
      if (!receipt && state.plan.raw && keccak256(state.plan.raw) === state.plan.deploymentHash) {
        await withStorageLock(WALLET_SECRET_OPERATION_LOCK_KEY, async () => { current(); await verifyBunkerInfrastructure(client); current(); await broadcastBunkerBytes(client, state!.plan.raw!); });
        await publishBunkerDeployment(state, current, true); return state;
      }
      if (!receipt || receipt.status !== "reverted") throw new Error("Check pending deployment before retrying");
    }
    const estimate = await estimateBunkerDeployment(state, payerId, client);
    if (BigInt(gas.gasLimit) < BigInt(estimate.gas.gasLimit) * 10n / 12n || BigInt(gas.gasLimit) > 10000000n) throw new Error("Deployment gas changed. Review again.");
    if (await client.getBalance({ address }) < BigInt(gas.gasLimit) * BigInt(gas.maxFeePerGas)) throw new Error("Gas payer has insufficient Sepolia ETH");
    const rpc = client.transport.url as string;
    const broadcast = await submitBunkerOuter({ id, payerId, payerAddress: address, rpc, to: BUNKER_PINS.factory.address as Hex,
      data: deploymentData(state.plan), gas, current,
      beforeBroadcast: async ({ transactionHash, serializedTransaction }) => {
        await verifyBunkerInfrastructure(client); current();
        state = (await readBunkerState(id, current()))!;
        state.plan.deploymentHash = transactionHash; state.plan.raw = serializedTransaction;
        if (remember) state.defaultPayer = { id: payerId, address };
        await writeBunkerState(state, current);
      } });
    await publishBunkerDeployment(state, current, broadcast.broadcastUncertain);
    return state;
  });
}
export function decodeBunkerDeploymentTransaction(input: Hex) { return decodeFunctionData({ abi: FACTORY_ABI, data: input }); }
