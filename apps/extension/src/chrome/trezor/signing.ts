import {
  createWalletClient,
  getAddress,
  getTypesForEIP712Domain,
  hashDomain,
  hashStruct,
  hashTypedData,
  http,
  keccak256,
  recoverAddress,
  recoverMessageAddress,
  recoverTransactionAddress,
  serializeTransaction,
  toHex,
  type Chain,
  type TransactionSerializable,
  type TypedData,
} from "viem";
import {
  RPC_URLS,
  VIEM_CHAINS,
  buildCustomViemChain,
} from "@/constants/chainRegistry";
import { getStoredResolvedChainById } from "@/lib/chains";
import type { TransactionParams } from "../bankr/submission";
import { broadcastSerializedTransaction } from "../localSigner";
import type { SignedTransaction } from "../localSigner";
import type { SignatureMethod } from "../requests/pendingSignatureStorage";
import type { TrezorAccount } from "../types";
import {
  signTrezorMessage,
  signTrezorTransaction,
  signTrezorTypedData,
} from "./offscreenBridge";
import type {
  TrezorEip1559Transaction,
  TrezorLegacyTransaction,
} from "./types";
import { decodeTrezorAccount } from "./storage";

interface GasOverrides {
  gasLimit: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
}

type TrezorTypedData = {
  types: TypedData;
  primaryType: string;
  domain: Record<string, unknown>;
  message: Record<string, unknown>;
};

/** Sign exact chain-bound EIP-712 data and recover it to the pinned Trezor. */
export async function signTrezorTypedDataForAccount(input: {
  opId: string;
  account: TrezorAccount;
  typedData: object;
  chainId: number;
}): Promise<`0x${string}`> {
  decodeTrezorAccount(input.account);
  const supplied = input.typedData as TrezorTypedData;
  // Match viem's digest normalization and give Suite the same explicit schema.
  // Preserve an explicitly supplied domain type, including its field order.
  const typedData = {
    ...supplied,
    types: {
      EIP712Domain: getTypesForEIP712Domain({ domain: supplied.domain }),
      ...supplied.types,
    },
  };
  const domainChainId = Number(typedData.domain?.chainId);
  if (Number.isFinite(domainChainId) && domainChainId !== input.chainId) {
    throw new Error(
      `Provided chainId "${domainChainId}" must match the active chainId "${input.chainId}"`,
    );
  }

  // Compute every digest locally before the device interaction. The separate
  // hashes allow older/hash-only firmware to sign the exact same reviewed
  // schema without WalletChan ever changing the payload.
  const typedDataParameters = typedData as never;
  const expectedDigest = hashTypedData(typedDataParameters);
  const domainSeparatorHash = hashDomain({
    domain: typedData.domain,
    types: typedData.types,
  } as never);
  const messageHash = hashStruct({
    data: typedData.message,
    primaryType: typedData.primaryType,
    types: typedData.types,
  } as never);
  const result = await signTrezorTypedData({
    opId: input.opId,
    deviceId: input.account.deviceId,
    hdPath: input.account.hdPath,
    typedData: typedData as Record<string, unknown>,
    domainSeparatorHash,
    messageHash,
  });
  return verifyTrezorTypedDataSignature({
    account: input.account,
    address: result.address,
    signature: result.signature,
    expectedDigest,
  });
}

export async function signAndBroadcastTrezorTransaction(input: {
  opId: string;
  account: TrezorAccount;
  tx: TransactionParams & { nonce: number };
  gasOverrides?: GasOverrides;
  beforeBroadcast?: (prepared: {
    serializedTransaction: `0x${string}`;
    transactionHash: `0x${string}`;
  }) => Promise<void>;
}): Promise<SignedTransaction> {
  decodeTrezorAccount(input.account);
  const { chain, rpcUrl } = await resolveChain(input.tx.chainId);
  const client = createWalletClient({
    chain,
    transport: http(rpcUrl, { timeout: 30_000 }),
  });
  const tx = input.gasOverrides
    ? {
        ...input.tx,
        gas: input.gasOverrides.gasLimit,
        maxFeePerGas: input.gasOverrides.maxFeePerGas,
        maxPriorityFeePerGas: input.gasOverrides.maxPriorityFeePerGas,
        gasPrice: undefined,
      }
    : input.tx;
  const prepared = await client.prepareTransactionRequest({
    account: getAddress(input.account.address),
    chain,
    to: tx.to ? getAddress(tx.to) : undefined,
    data: (tx.data || "0x") as `0x${string}`,
    value: BigInt(tx.value || "0"),
    nonce: tx.nonce,
    ...(tx.gas ? { gas: BigInt(tx.gas) } : {}),
    ...(tx.gasPrice ? { gasPrice: BigInt(tx.gasPrice) } : {}),
    ...(tx.maxFeePerGas ? { maxFeePerGas: BigInt(tx.maxFeePerGas) } : {}),
    ...(tx.maxPriorityFeePerGas
      ? { maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGas) }
      : {}),
  } as never);
  const serializable = stripPreparedContext(
    prepared as Record<string, unknown>,
  );
  const transaction = buildTrezorTransactionPayload(
    serializable,
    input.tx.chainId,
  );
  const result = await signTrezorTransaction({
    opId: input.opId,
    deviceId: input.account.deviceId,
    hdPath: input.account.hdPath,
    transaction,
  });
  const reconstructed = await verifyTrezorSignedTransaction({
    account: input.account,
    transaction: serializable,
    result,
    chainId: input.tx.chainId,
  });
  await input.beforeBroadcast?.({
    serializedTransaction: reconstructed,
    transactionHash: keccak256(reconstructed),
  });
  const broadcast = await broadcastSerializedTransaction(
    client as never,
    reconstructed,
    {
      chainId: input.tx.chainId,
      supportsSyncSend: false,
    },
  );
  return { ...broadcast, signedGasLimit: serializable.gas };
}

export async function signTrezorSignatureRequest(input: {
  opId: string;
  account: TrezorAccount;
  method: SignatureMethod;
  params: unknown[];
  chainId: number;
}): Promise<`0x${string}`> {
  decodeTrezorAccount(input.account);
  if (input.method === "eth_sign") {
    throw new Error("eth_sign is not supported.");
  }
  if (input.method !== "personal_sign") {
    const raw = input.params[1];
    const typedData = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!typedData || typeof typedData !== "object") {
      throw new Error("Invalid typed data.");
    }
    return signTrezorTypedDataForAccount({
      opId: input.opId,
      account: input.account,
      typedData: typedData as Record<string, unknown>,
      chainId: input.chainId,
    });
  }

  const raw = input.params[0];
  const messageHex =
    typeof raw === "string" && raw.startsWith("0x")
      ? (raw as `0x${string}`)
      : toHex(String(raw ?? ""));
  const result = await signTrezorMessage({
    opId: input.opId,
    deviceId: input.account.deviceId,
    hdPath: input.account.hdPath,
    message: messageHex,
  });
  return verifyTrezorMessageSignature({
    account: input.account,
    address: result.address,
    signature: result.signature,
    messageHex,
  });
}

export function buildTrezorTransactionPayload(
  transaction: TransactionSerializable,
  chainId: number,
): TrezorLegacyTransaction | TrezorEip1559Transaction {
  if (transaction.type === "eip2930") {
    throw new Error("EIP-2930-only transactions are not supported by Trezor.");
  }
  const common = {
    to: transaction.to ?? null,
    value: toHex(transaction.value ?? 0n),
    gasLimit: toHex(transaction.gas ?? 0n),
    nonce: toHex(transaction.nonce ?? 0),
    data: transaction.data ?? "0x",
    chainId,
  };
  if (
    transaction.type === "eip1559" ||
    transaction.maxFeePerGas !== undefined ||
    transaction.maxPriorityFeePerGas !== undefined
  ) {
    if (
      transaction.maxFeePerGas === undefined ||
      transaction.maxPriorityFeePerGas === undefined
    ) {
      throw new Error("Trezor requires both EIP-1559 fee fields.");
    }
    return {
      ...common,
      maxFeePerGas: toHex(transaction.maxFeePerGas),
      maxPriorityFeePerGas: toHex(transaction.maxPriorityFeePerGas),
      accessList: transaction.accessList?.map((entry) => ({
        address: entry.address,
        storageKeys: [...entry.storageKeys],
      })),
    };
  }
  if (transaction.gasPrice === undefined) {
    throw new Error("Trezor requires a legacy gas price.");
  }
  return {
    ...common,
    gasPrice: toHex(transaction.gasPrice),
  };
}

export async function verifyTrezorSignedTransaction(input: {
  account: TrezorAccount;
  transaction: TransactionSerializable;
  result: { r: string; s: string; v: string; serializedTx: string };
  chainId: number;
}): Promise<`0x${string}`> {
  decodeTrezorAccount(input.account);
  const r = normalizeSignatureWord(input.result.r);
  const s = normalizeSignatureWord(input.result.s);
  const yParity = normalizeYParity(input.result.v, input.chainId);
  const reconstructed = serializeTransaction(input.transaction, {
    r,
    s,
    yParity,
  });
  const deviceSerialized = normalizeSerializedTransaction(
    input.result.serializedTx,
  );
  if (deviceSerialized.toLowerCase() !== reconstructed.toLowerCase()) {
    throw new Error(
      "Trezor returned transaction bytes that do not match the reviewed request.",
    );
  }
  const recovered = await recoverTransactionAddress({
    serializedTransaction: reconstructed,
  });
  assertRecoveredSigner(recovered, input.account);
  return reconstructed;
}

export async function verifyTrezorMessageSignature(input: {
  account: TrezorAccount;
  address: string;
  signature: string;
  messageHex: `0x${string}`;
}): Promise<`0x${string}`> {
  decodeTrezorAccount(input.account);
  assertReturnedAddress(input.address, input.account);
  const signature = normalizeSignature(input.signature);
  const recovered = await recoverMessageAddress({
    message: { raw: input.messageHex },
    signature,
  });
  assertRecoveredSigner(recovered, input.account);
  return signature;
}

export async function verifyTrezorTypedDataSignature(input: {
  account: TrezorAccount;
  address: string;
  signature: string;
  expectedDigest: `0x${string}`;
}): Promise<`0x${string}`> {
  decodeTrezorAccount(input.account);
  assertReturnedAddress(input.address, input.account);
  const signature = normalizeSignature(input.signature);
  const recovered = await recoverAddress({
    hash: input.expectedDigest,
    signature,
  });
  assertRecoveredSigner(recovered, input.account);
  return signature;
}

async function resolveChain(
  chainId: number,
): Promise<{ chain: Chain; rpcUrl: string }> {
  const resolved = await getStoredResolvedChainById(chainId);
  const rpcUrl = resolved?.rpcUrl || RPC_URLS[chainId];
  if (!rpcUrl) throw new Error(`No RPC URL configured for chain ${chainId}.`);
  const chain =
    VIEM_CHAINS[chainId] ||
    buildCustomViemChain(
      chainId,
      resolved?.name || `Chain ${chainId}`,
      rpcUrl,
      resolved?.nativeCurrency,
      resolved?.explorer || undefined,
    );
  return { chain, rpcUrl };
}

function stripPreparedContext(
  prepared: Record<string, unknown>,
): TransactionSerializable {
  const transaction = { ...prepared };
  delete transaction.account;
  delete transaction.chain;
  delete transaction.from;
  return transaction as TransactionSerializable;
}

function normalizeSignatureWord(value: string): `0x${string}` {
  if (!/^(?:0x)?[0-9a-fA-F]{1,64}$/.test(value)) {
    throw new Error("Trezor returned an invalid transaction signature.");
  }
  return toHex(BigInt(value.startsWith("0x") ? value : `0x${value}`), {
    size: 32,
  });
}

function normalizeYParity(value: string, chainId: number): 0 | 1 {
  if (!/^(?:0x)?[0-9a-fA-F]{1,64}$/.test(value)) {
    throw new Error("Trezor returned an invalid transaction signature.");
  }
  const v = BigInt(value.startsWith("0x") ? value : `0x${value}`);
  if (v === 0n || v === 1n) return Number(v) as 0 | 1;
  if (v === 27n || v === 28n) return Number(v - 27n) as 0 | 1;
  if (v < 35n) {
    throw new Error("Trezor returned an invalid transaction recovery value.");
  }
  return Number((v - 35n - 2n * BigInt(chainId)) & 1n) as 0 | 1;
}

function normalizeSerializedTransaction(value: string): `0x${string}` {
  const normalized = value.startsWith("0x") ? value : `0x${value}`;
  if (!/^0x[0-9a-fA-F]+$/.test(normalized) || normalized.length % 2 !== 0) {
    throw new Error("Trezor returned invalid serialized transaction bytes.");
  }
  return normalized as `0x${string}`;
}

function normalizeSignature(value: string): `0x${string}` {
  const normalized = value.startsWith("0x") ? value : `0x${value}`;
  if (!/^0x[0-9a-fA-F]{130}$/.test(normalized)) {
    throw new Error("Trezor returned an invalid signature.");
  }
  return normalized as `0x${string}`;
}

function assertReturnedAddress(
  returnedAddress: string,
  account: TrezorAccount,
): void {
  if (returnedAddress.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(
      "Trezor signed with a different account. Check the connected device, passphrase wallet, and derivation path.",
    );
  }
}

function assertRecoveredSigner(
  recoveredAddress: string,
  account: TrezorAccount,
): void {
  if (recoveredAddress.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(
      "Trezor signed with a different account. Check the connected device, passphrase wallet, and derivation path.",
    );
  }
}
