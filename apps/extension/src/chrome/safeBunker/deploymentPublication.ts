import { keccak256, parseTransaction, recoverTransactionAddress } from "viem";
import { getAccounts, setActiveAccountId } from "../accountStorage";
import { isSafeExecutorAccount } from "../safe/accountTypePolicy";
import { addTxToHistoryIfAbsent, updateTxInHistory, type CompletedTransaction } from "../txHistoryStorage";
import { startReceiptPolling } from "../forceInclusion/receiptPoller";
import { WALLET_SECRET_OPERATION_LOCK_KEY, withStorageLock } from "../storageLock";
import type { SafeBunkerAccount } from "../types";
import type { BunkerAccess } from "./access";
import { deploymentData } from "./deployment";
import { bunkerEntry } from "./live";
import { BUNKER_CHAIN_ID, BUNKER_PINS } from "./network";
import { writeBunkerState } from "./stateRepository";
import type { BunkerState } from "./types";

/** Public pending metadata never substitutes for the authenticated signed deployment. */
export async function readSignedBunkerDeployment(state: BunkerState) {
  const { raw, deploymentHash } = state.plan;
  if (!raw || !deploymentHash || keccak256(raw) !== deploymentHash) throw new Error("Bunker deployment identity changed");
  const tx = parseTransaction(raw);
  if (tx.type !== "eip1559" || (tx.gas ?? 0n) <= 0n || tx.chainId !== BUNKER_CHAIN_ID || tx.to?.toLowerCase() !== BUNKER_PINS.factory.address.toLowerCase() ||
      tx.data?.toLowerCase() !== deploymentData(state.plan).toLowerCase() || (tx.value ?? 0n) !== 0n)
    throw new Error("Bunker deployment identity changed");
  const sender = (await recoverTransactionAddress({ serializedTransaction: raw as `0x02${string}` })).toLowerCase();
  return { tx, sender, hash: deploymentHash };
}

/** One public row per account and hash; signed factory calldata stays encrypted. */
export async function ensureBunkerDeploymentHistory(state: BunkerState, uncertain?: boolean) {
  if (!state.plan.raw || !state.plan.deploymentHash) return;
  const { tx, sender, hash } = await readSignedBunkerDeployment(state);
  const accounts = await getAccounts();
  const bunker = accounts.find(a => a.id === state.accountId && a.type === "safeBunker" && a.seedVaultId === state.id);
  if (!bunker) return;
  const payer = accounts.find(a => a.address.toLowerCase() === sender && isSafeExecutorAccount(a));
  const createdAt = (await bunkerEntry(state.id)).header.createdAt;
  for (const account of [bunker, ...(payer ? [payer] : [])]) {
    const entry: CompletedTransaction = {
      id: `bunker-deployment:${account.id}:${hash}`, accountId: account.id, ...(isSafeExecutorAccount(account) ? { accountType: account.type } : {}),
      chainId: BUNKER_CHAIN_ID, chainName: "Sepolia", createdAt, origin: "Deploy Safe Bunker", favicon: null,
      safeDeploymentMeta: { safeAddress: state.plan.address, payerAddress: sender },
      functionName: "Deploy Safe Bunker", status: "pending", txHash: hash,
      ...(uncertain ? { broadcastUncertain: true } : {}),
      tx: { chainId: BUNKER_CHAIN_ID, from: account.id === bunker.id ? state.plan.address : sender,
        to: BUNKER_PINS.factory.address, value: "0", nonce: tx.nonce, gas: tx.gas?.toString(),
        maxFeePerGas: tx.maxFeePerGas?.toString(), maxPriorityFeePerGas: tx.maxPriorityFeePerGas?.toString() },
    };
    const stored = await addTxToHistoryIfAbsent(entry);
    if (uncertain === false && stored.broadcastUncertain) await updateTxInHistory(entry.id, { broadcastUncertain: false });
    if (stored.status === "pending") startReceiptPolling(entry.id, hash, BUNKER_CHAIN_ID);
  }
}

/** Called only after a broadcast attempt; confirmation remains a separate authority gate. */
export async function publishBunkerDeployment(state: BunkerState, current: BunkerAccess, uncertain: boolean) {
  await readSignedBunkerDeployment(state);
  await withStorageLock(WALLET_SECRET_OPERATION_LOCK_KEY, async () => {
    current();
    const entry = await bunkerEntry(state.id), accounts = await getAccounts();
    const existing = accounts.find(a => a.id === state.accountId);
    if (existing && (existing.type !== "safeBunker" || existing.seedVaultId !== state.id || existing.address !== state.plan.address))
      throw new Error("Bunker account identity collision");
    if (accounts.some(a => a.id !== state.accountId && a.address.toLowerCase() === state.plan.address)) throw new Error("Safe address is already present in this wallet");
    const pending: SafeBunkerAccount = { id: state.accountId, type: "safeBunker", address: state.plan.address,
      displayName: entry.header.name, chainId: BUNKER_CHAIN_ID, seedVaultId: state.id, derivationVersion: 1,
      createdAt: entry.header.createdAt, deploymentPending: true, ...(state.backupConfirmed ? {} : { backupPending: true }) };
    current(); await writeBunkerState(state, current, { accounts: existing ? accounts : [...accounts, pending] });
    await ensureBunkerDeploymentHistory(state, uncertain); current();
    await setActiveAccountId(state.accountId); current();
  });
  chrome.runtime.sendMessage({ type: "accountsUpdated" }).catch(() => {});
}
