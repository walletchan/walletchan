import { getAccountById } from "../accountStorage";
import { getLocalPrivateKeyForAccount } from "../accounts/localKeyResolver";
import { isSafeExecutorAccount } from "../safe/accountTypePolicy";
import { createLocalSignerClient } from "../localSigning/client";
import { secureHttpTransport } from "../network/rpcClient";
import { WALLET_SECRET_OPERATION_LOCK_KEY, withStorageLock } from "../storageLock";
import { broadcastBunkerBytes } from "./broadcast";
import { signPreparedLedgerTransaction } from "../ledger/signing";
import { ensureLedgerSigningSession } from "../ledger/session";
import { getNextNonce, resetNonce } from "../forceInclusion/nonceManager";
import type { GasOverrides } from "../transactions/localExecution";
import { createWalletClient, keccak256, type Hex, type TransactionSerializable } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import type { BunkerAccess } from "./access";
import { BUNKER_CHAIN_ID } from "./network";

export async function bunkerPayer(id: string, expected?: string) {
  const account = await getAccountById(id);
  if (!account || !isSafeExecutorAccount(account) || (expected && account.address.toLowerCase() !== expected)) throw new Error("Choose a private-key, seed-phrase or Ledger gas payer");
  return account;
}
export async function submitBunkerOuter(input: {
  id: string; payerId: string; payerAddress: Hex; to: Hex; data: Hex; rpc: string;
  gas: GasOverrides; current: BunkerAccess;
  beforeBroadcast: (prepared: { serializedTransaction: Hex; transactionHash: Hex }) => Promise<void>;
}) {
  input.current(); const payer = await bunkerPayer(input.payerId, input.payerAddress);
  const tx = { chainId: BUNKER_CHAIN_ID, from: payer.address, to: input.to, value: "0", data: input.data,
    gas: input.gas.gasLimit, maxFeePerGas: input.gas.maxFeePerGas, maxPriorityFeePerGas: input.gas.maxPriorityFeePerGas };
  const beforeBroadcast = async (p: { serializedTransaction: Hex; transactionHash: Hex }) => {
    input.current(); const live = await bunkerPayer(payer.id, input.payerAddress);
    if (live.type !== payer.type || (payer.type === "ledger" && (live.type !== "ledger" || live.deviceId !== payer.deviceId || live.hdPath !== payer.hdPath))) throw new Error("Gas payer changed");
    await input.beforeBroadcast(p); input.current();
  };
  if (payer.type === "ledger") {
    await ensureLedgerSigningSession(""); input.current();
    const nonce = await getNextNonce(payer.address, BUNKER_CHAIN_ID);
    let persisted = false;
    try {
      const client = createWalletClient({ chain: sepolia, transport: secureHttpTransport(input.rpc, { timeout: 15000, retryCount: 0 }) });
      const transaction: TransactionSerializable = { type: "eip1559", chainId: BUNKER_CHAIN_ID, to: input.to,
        data: input.data, value: 0n, nonce, gas: BigInt(input.gas.gasLimit), maxFeePerGas: BigInt(input.gas.maxFeePerGas), maxPriorityFeePerGas: BigInt(input.gas.maxPriorityFeePerGas) };
      const raw = await signPreparedLedgerTransaction({ account: payer, opId: `bunker:${input.id}`, transaction });
      return await withStorageLock(WALLET_SECRET_OPERATION_LOCK_KEY, async () => {
        await beforeBroadcast({ serializedTransaction: raw, transactionHash: keccak256(raw) }); persisted = true;
        input.current(); return broadcastBunkerBytes(client, raw);
      });
    } catch (error) { if (!persisted) resetNonce(payer.address, BUNKER_CHAIN_ID); throw error; }
  }
  const key = await getLocalPrivateKeyForAccount(payer.id, ""); input.current();
  if (!key) throw new Error("Unlock the gas payer account");
  if (privateKeyToAccount(key).address.toLowerCase() !== payer.address.toLowerCase()) throw new Error("Gas payer key does not match account");
  const { client } = createLocalSignerClient(BUNKER_CHAIN_ID, key, input.rpc);
  return withStorageLock(WALLET_SECRET_OPERATION_LOCK_KEY, async () => {
    input.current();
    const prepared = await client.prepareTransactionRequest({ type: "eip1559", chainId: BUNKER_CHAIN_ID, parameters: ["nonce"], to: input.to, data: input.data, value: 0n,
      gas: BigInt(tx.gas), maxFeePerGas: BigInt(tx.maxFeePerGas), maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGas) });
    const raw = await client.signTransaction(prepared);
    await beforeBroadcast({ serializedTransaction: raw, transactionHash: keccak256(raw) });
    input.current(); return broadcastBunkerBytes(client, raw);
  });
}
