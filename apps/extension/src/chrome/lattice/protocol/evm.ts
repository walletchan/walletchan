/**
 * EVM payloads for Lattice generic signing, and signature finalisation.
 *
 * Mirrors ape-grid-lattice `ape_grid/client.py` (`build_tx_preimage`,
 * `sign_message`, `sign_typed_data`, `_sign_evm`). The local keccak digest is
 * the authority: a device-reported digest must match it, and y-parity is
 * recovered against it.
 */
import { secp256k1 } from "@noble/curves/secp256k1";
import {
  bytesToHex,
  concat,
  hexToBytes,
  keccak256,
  serializeTransaction,
  toBytes,
  type Address,
  type Hex,
  type TransactionSerializable,
} from "viem";
import { publicKeyToAddress } from "viem/accounts";

import { isValidBip32Path } from "../../../lib/bip32Path";
import { bytesToBigInt, equalBytes } from "./bytes";
import type { LatticeProtocolClient } from "./client";
import { LATTICE_HARDENED_OFFSET, LatticeSignEncoding, LatticeSignHash } from "./constants";
import { recoverYParity } from "./encoding";
import { LatticeProtocolError } from "./errors";

/** "m/44'/60'/0'/0/3" -> hardened-index array; Lattice accepts 2 to 5 levels. */
export function latticeSignerPath(hdPath: string): number[] {
  if (!isValidBip32Path(hdPath)) throw new Error("Invalid Lattice derivation path.");
  const indices = hdPath
    .slice(2)
    .split("/")
    .map((part) => {
      const hardened = part.endsWith("'");
      const value = Number(hardened ? part.slice(0, -1) : part);
      return hardened ? value + LATTICE_HARDENED_OFFSET : value;
    });
  if (indices.length < 2 || indices.length > 5) throw new Error("Lattice derivation paths have 2 to 5 levels.");
  return indices;
}

/** Unsigned EIP-2718 bytes (EIP-155 RLP for legacy with chainId). */
export function evmTransactionPayload(tx: TransactionSerializable): Uint8Array {
  return hexToBytes(serializeTransaction(tx));
}

/** EIP-191 personal_sign preimage. */
export function personalSignPayload(message: Uint8Array): Uint8Array {
  return concat([toBytes(`\x19Ethereum Signed Message:\n${message.length}`), message]);
}

/** EIP-712 preimage `0x1901 || domainSeparator || messageHash`; the device shows these hashes. */
export function typedDataHashPayload(domainSeparator: Hex, messageHash?: Hex): Uint8Array {
  const parts: Hex[] = ["0x1901", domainSeparator];
  if (messageHash) parts.push(messageHash);
  return hexToBytes(concat(parts));
}

export interface LatticeEvmSignature {
  r: Hex;
  s: Hex;
  yParity: 0 | 1;
  /** keccak256 of the payload; what the device signed. */
  digest: Hex;
  /** Address of the key the device signed with. */
  signer: Address;
  /** The device saw only the digest because the payload exceeded its limit. */
  prehashed: boolean;
  decoderAttached: boolean;
}

const HALF_N = secp256k1.CURVE.n / 2n;

export async function signLatticeEvmPayload(
  client: LatticeProtocolClient,
  input: {
    signerPath: readonly number[];
    payload: Uint8Array;
    encoding: LatticeSignEncoding;
    decoder?: Uint8Array;
    signal?: AbortSignal;
  },
): Promise<LatticeEvmSignature> {
  const result = await client.signGeneric({
    signerPath: input.signerPath,
    payload: input.payload,
    hashType: LatticeSignHash.KECCAK256,
    encoding: input.encoding,
    decoder: input.decoder,
    signal: input.signal,
  });
  const digest = keccak256(input.payload, "bytes");
  if (result.digest.length > 0 && !equalBytes(result.digest, digest)) {
    throw new LatticeProtocolError("Lattice signed a different digest.");
  }
  if (result.pubkey.length === 0) throw new LatticeProtocolError("Lattice omitted the signing public key.");
  if (bytesToBigInt(result.s) > HALF_N) throw new LatticeProtocolError("Lattice returned a high-s signature.");
  const yParity = recoverYParity(digest, result.r, result.s, result.pubkey);
  const uncompressed = secp256k1.ProjectivePoint.fromHex(result.pubkey).toRawBytes(false);
  return {
    r: bytesToHex(result.r),
    s: bytesToHex(result.s),
    yParity,
    digest: bytesToHex(digest),
    signer: publicKeyToAddress(bytesToHex(uncompressed)),
    prehashed: result.prehashed,
    decoderAttached: result.decoderAttached,
  };
}

/** Signs a transaction and returns the broadcastable serialization. */
export async function signLatticeTransaction(
  client: LatticeProtocolClient,
  input: { signerPath: readonly number[]; tx: TransactionSerializable; decoder?: Uint8Array; signal?: AbortSignal },
): Promise<LatticeEvmSignature & { serialized: Hex }> {
  const signature = await signLatticeEvmPayload(client, {
    signerPath: input.signerPath,
    payload: evmTransactionPayload(input.tx),
    encoding: LatticeSignEncoding.EVM,
    decoder: input.decoder,
    signal: input.signal,
  });
  const legacy = input.tx.type === undefined || input.tx.type === "legacy";
  const chainId = input.tx.chainId;
  const v = legacy
    ? chainId
      ? BigInt(chainId) * 2n + 35n + BigInt(signature.yParity)
      : 27n + BigInt(signature.yParity)
    : undefined;
  const serialized = serializeTransaction(input.tx, {
    r: signature.r,
    s: signature.s,
    yParity: signature.yParity,
    ...(v === undefined ? {} : { v }),
  });
  return { ...signature, serialized };
}

export function signLatticePersonalMessage(
  client: LatticeProtocolClient,
  input: { signerPath: readonly number[]; message: Uint8Array; signal?: AbortSignal },
): Promise<LatticeEvmSignature> {
  return signLatticeEvmPayload(client, {
    signerPath: input.signerPath,
    payload: personalSignPayload(input.message),
    encoding: LatticeSignEncoding.NONE,
    signal: input.signal,
  });
}

/** Hash-only EIP-712 (phase 1). Full on-device fields need the ETH_MSG port. */
export function signLatticeTypedDataHashes(
  client: LatticeProtocolClient,
  input: { signerPath: readonly number[]; domainSeparator: Hex; messageHash?: Hex; signal?: AbortSignal },
): Promise<LatticeEvmSignature> {
  return signLatticeEvmPayload(client, {
    signerPath: input.signerPath,
    payload: typedDataHashPayload(input.domainSeparator, input.messageHash),
    encoding: LatticeSignEncoding.NONE,
    signal: input.signal,
  });
}
