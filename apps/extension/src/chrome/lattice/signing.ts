import {
  getTypesForEIP712Domain,
  hashDomain,
  hashStruct,
  hexToBytes,
  recoverMessageAddress,
  recoverTransactionAddress,
  recoverTypedDataAddress,
  serializeSignature,
  toHex,
  type Hex,
  type TransactionSerializable,
} from "viem";
import { prepareSignAndBroadcastHardwareTransaction } from "../ledger/signing";
import type { TransactionParams } from "../bankr/submission";
import type { LatticeAccount } from "../types";
import type { SignatureMethod } from "../requests/pendingSignatureStorage";
import type { SignedTransaction } from "../localSigner";
import {
  signLatticePersonalMessage,
  signLatticeTransaction,
  signLatticeTypedData,
  type LatticeEvmSignature,
} from "./protocol";
import { withLatticeAccount } from "./operations";

interface GasOverrides {
  gasLimit: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
}

const WRONG_ACCOUNT = "Lattice signed with a different account.";

function assertSigner(recovered: string, account: LatticeAccount): void {
  if (recovered.toLowerCase() !== account.address.toLowerCase()) throw new Error(WRONG_ACCOUNT);
}

function signatureHex(signature: LatticeEvmSignature): Hex {
  return serializeSignature({ r: signature.r, s: signature.s, yParity: signature.yParity });
}

/** Sign exact prepared bytes without broadcasting. */
export async function signPreparedLatticeTransaction(input: {
  opId: string;
  account: LatticeAccount;
  transaction: TransactionSerializable;
}): Promise<`0x${string}`> {
  const transaction = input.transaction;
  if (!Number.isSafeInteger(Number(transaction.chainId)) || Number(transaction.chainId) <= 0) {
    throw new Error("Lattice transaction requires an explicit chain ID");
  }
  if (transaction.type === "eip7702" || transaction.type === "eip4844") {
    throw new Error("Unsupported Lattice transaction type");
  }
  const signed = await withLatticeAccount(
    { opId: input.opId, account: input.account },
    ({ client, signerPath, signal }) => signLatticeTransaction(client, { signerPath, tx: transaction, signal }),
  );
  assertSigner(signed.signer, input.account);
  assertSigner(await recoverTransactionAddress({ serializedTransaction: signed.serialized as never }), input.account);
  return signed.serialized;
}

export async function signAndBroadcastLatticeTransaction(input: {
  opId: string;
  account: LatticeAccount;
  tx: TransactionParams & { nonce: number };
  gasOverrides?: GasOverrides;
  beforeBroadcast?: (prepared: {
    serializedTransaction: `0x${string}`;
    transactionHash: `0x${string}`;
  }) => Promise<void>;
}): Promise<SignedTransaction> {
  return prepareSignAndBroadcastHardwareTransaction({
    ...input,
    address: input.account.address,
    sign: (transaction) => signPreparedLatticeTransaction({ opId: input.opId, account: input.account, transaction }),
  });
}

/**
 * Sign exact chain-bound EIP-712 data. The Lattice shows the fields when it
 * can, else the domain and message hashes; the result is recovered against
 * the full typed data and the pinned account.
 */
export async function signLatticeTypedDataForAccount(input: {
  opId: string;
  account: LatticeAccount;
  typedData: object;
  chainId: number;
}): Promise<`0x${string}`> {
  const typedData = input.typedData as {
    domain?: Record<string, unknown>;
    types?: Record<string, Array<{ name: string; type: string }>>;
    primaryType?: string;
    message?: Record<string, unknown>;
  };
  const domain = typedData.domain ?? {};
  const domainChainId = Number(domain.chainId);
  if (Number.isFinite(domainChainId) && domainChainId !== input.chainId) {
    throw new Error(
      `Provided chainId "${domainChainId}" must match the active chainId "${input.chainId}"`,
    );
  }
  if (!typedData.types || typeof typedData.primaryType !== "string") {
    throw new Error("Invalid typed data.");
  }
  const types = {
    EIP712Domain: typedData.types.EIP712Domain ?? getTypesForEIP712Domain({ domain: domain as never }),
    ...typedData.types,
  };
  const domainHash = hashDomain({ domain, types } as never);
  const messageHash = typedData.primaryType === "EIP712Domain"
    ? undefined
    : hashStruct({ data: typedData.message ?? {}, primaryType: typedData.primaryType, types } as never);
  const signed = await withLatticeAccount(
    { opId: input.opId, account: input.account },
    ({ client, signerPath, signal }) =>
      signLatticeTypedData(client, {
        signerPath,
        typedData: input.typedData as Record<string, unknown>,
        domainSeparator: domainHash,
        messageHash,
        signal,
      }),
  );
  assertSigner(signed.signer, input.account);
  const signature = signatureHex(signed);
  assertSigner(await recoverTypedDataAddress({ ...typedData, signature } as never), input.account);
  return signature;
}

export async function signLatticeSignatureRequest(input: {
  opId: string;
  account: LatticeAccount;
  method: SignatureMethod;
  params: unknown[];
  chainId: number;
}): Promise<`0x${string}`> {
  if (input.method === "eth_sign") throw new Error("eth_sign is not supported.");
  if (input.method !== "personal_sign") {
    const raw = input.params[1];
    const typedData = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!typedData || typeof typedData !== "object") throw new Error("Invalid typed data.");
    return signLatticeTypedDataForAccount({
      opId: input.opId,
      account: input.account,
      typedData: typedData as Record<string, unknown>,
      chainId: input.chainId,
    });
  }
  const raw = input.params[0];
  const messageHex = typeof raw === "string" && raw.startsWith("0x")
    ? raw as `0x${string}`
    : toHex(String(raw ?? ""));
  const message = hexToBytes(messageHex);
  const signed = await withLatticeAccount(
    { opId: input.opId, account: input.account },
    ({ client, signerPath, signal }) => signLatticePersonalMessage(client, { signerPath, message, signal }),
  );
  assertSigner(signed.signer, input.account);
  const signature = signatureHex(signed);
  assertSigner(await recoverMessageAddress({ message: { raw: messageHex }, signature }), input.account);
  return signature;
}
