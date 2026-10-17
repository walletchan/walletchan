import { isAddress } from "viem";
import {
  MAX_HEX_DATA_CHARS,
  MAX_SIGNATURE_PAYLOAD_CHARS,
  serializedJsonLength,
} from "../provider/limits";
import {
  isReleasedTrezorPath,
  type TrezorDerivationRow,
} from "./derivation";
import {
  TrezorError,
  TrezorErrorCode,
} from "./errors";
import type {
  TrezorAddress,
  TrezorMessageSignature,
  TrezorSignedTransaction,
  TrezorTransaction,
} from "./types";
import { isValidBip32Path } from "@/lib/bip32Path";

const MAX_SIGNATURE_CHARS = 132;
const MAX_SERIALIZED_TRANSACTION_CHARS = MAX_HEX_DATA_CHARS + 1_024;
const HEX_RE = /^(?:0x)?[0-9a-fA-F]*$/;
const QUANTITY_RE = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/;
const SAFE_DEVICE_TEXT_RE = /^[^\p{Cc}]+$/u;

export function validateDeviceFeatures(payload: unknown): {
  label: string;
  model: string;
} {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw invalidResponse("Trezor returned invalid device metadata.");
  }
  const row = payload as Record<string, unknown>;
  const capabilities = row.capabilities;
  if (
    !Array.isArray(capabilities) ||
    !capabilities.includes("Capability_Ethereum")
  ) {
    throw new TrezorError(
      TrezorErrorCode.CAPABILITY_UNSUPPORTED,
      "This Trezor does not report Ethereum support.",
    );
  }
  const modelCandidate =
    typeof row.internal_model === "string" && row.internal_model.trim()
      ? row.internal_model
      : row.model;
  return {
    label: normalizeDeviceText(row.label, "Trezor"),
    model: normalizeDeviceText(modelCandidate, "Trezor"),
  };
}

export function validateDeviceIdentity(deviceId: string): `0x${string}` {
  if (!isAddress(deviceId)) {
    throw invalidResponse("The stored Trezor identity is invalid.");
  }
  return deviceId.toLowerCase() as `0x${string}`;
}

export function validateIdentityPayload(
  payload: {
    address: string;
    serializedPath: string;
  },
  expectedPath: string,
): `0x${string}` {
  if (
    !payload ||
    payload.serializedPath !== expectedPath ||
    !isAddress(payload.address)
  ) {
    throw invalidResponse("Trezor returned an invalid device identity.");
  }
  return payload.address.toLowerCase() as `0x${string}`;
}

export function validateRows(rows: TrezorDerivationRow[]): void {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 20) {
    throw invalidResponse("Invalid Trezor address page.");
  }
  for (const row of rows) {
    if (!row || !isReleasedTrezorPath(row.hdPath, row.hdIndex)) {
      throw invalidResponse("Invalid Trezor derivation row.");
    }
  }
}

export function validateAddressPage(
  payload: Array<{ address: string; serializedPath: string }>,
  rows: TrezorDerivationRow[],
): TrezorAddress[] {
  if (!Array.isArray(payload) || payload.length !== rows.length) {
    throw invalidResponse("Trezor returned an incomplete address page.");
  }
  return payload.map((entry, index) => {
    const row = rows[index];
    if (
      !entry ||
      entry.serializedPath !== row.hdPath ||
      !isAddress(entry.address)
    ) {
      throw invalidResponse("Trezor returned an invalid address row.");
    }
    return {
      address: entry.address.toLowerCase() as `0x${string}`,
      hdPath: row.hdPath,
      hdIndex: row.hdIndex,
    };
  });
}

export function validatePath(path: string): void {
  if (
    typeof path !== "string" ||
    path.length > 128 ||
    !isValidBip32Path(path)
  ) {
    throw invalidResponse("Invalid Trezor derivation path.");
  }
}

export function validateTransaction(transaction: TrezorTransaction): void {
  if (
    !transaction ||
    typeof transaction !== "object" ||
    (transaction.to !== null && !isAddress(transaction.to)) ||
    !Number.isSafeInteger(transaction.chainId) ||
    transaction.chainId < 1 ||
    !isQuantity(transaction.value) ||
    !isQuantity(transaction.gasLimit) ||
    !isQuantity(transaction.nonce) ||
    !isBoundedHex(transaction.data ?? "0x", MAX_HEX_DATA_CHARS)
  ) {
    throw invalidResponse("Invalid Trezor transaction.");
  }
  if ("gasPrice" in transaction) {
    if (!isQuantity(transaction.gasPrice)) {
      throw invalidResponse("Invalid Trezor legacy fee.");
    }
    return;
  }
  if (
    !isQuantity(transaction.maxFeePerGas) ||
    !isQuantity(transaction.maxPriorityFeePerGas) ||
    (transaction.accessList !== undefined &&
      (!Array.isArray(transaction.accessList) ||
        transaction.accessList.length > 1_024 ||
        transaction.accessList.some(
          (entry) =>
            !entry ||
            !isAddress(entry.address) ||
            !Array.isArray(entry.storageKeys) ||
            entry.storageKeys.length > 1_024 ||
            entry.storageKeys.some(
              (key) => !/^0x[0-9a-fA-F]{64}$/.test(key),
            ),
        )))
  ) {
    throw invalidResponse("Invalid Trezor EIP-1559 transaction.");
  }
}

export function validateSignedTransaction(
  payload: TrezorSignedTransaction,
): TrezorSignedTransaction {
  if (
    !payload ||
    !isQuantity(payload.v) ||
    !isBoundedHex(payload.r, 66) ||
    !isBoundedHex(payload.s, 66) ||
    !isBoundedHex(
      payload.serializedTx,
      MAX_SERIALIZED_TRANSACTION_CHARS,
    )
  ) {
    throw invalidResponse("Trezor returned an invalid transaction signature.");
  }
  return payload;
}

export function validateTypedData(typedData: Record<string, unknown>): void {
  const length = serializedJsonLength(typedData);
  if (
    !typedData ||
    typeof typedData !== "object" ||
    length === null ||
    length > MAX_SIGNATURE_PAYLOAD_CHARS ||
    !typedData.types ||
    typeof typedData.primaryType !== "string" ||
    typedData.primaryType.length > 256 ||
    !typedData.domain ||
    !typedData.message
  ) {
    throw invalidResponse("Invalid Trezor typed data.");
  }
}

export function validateReturnedSignature(payload: {
  address: string;
  signature: string;
}): TrezorMessageSignature {
  if (
    !payload ||
    !isAddress(payload.address) ||
    !isBoundedHex(payload.signature, MAX_SIGNATURE_CHARS) ||
    stripHexPrefix(payload.signature).length !== 130
  ) {
    throw invalidResponse("Trezor returned an invalid signature.");
  }
  return {
    address: payload.address.toLowerCase(),
    signature: ensureHexPrefix(payload.signature),
  };
}

export function normalizeMessageHex(message: string): string {
  if (
    typeof message !== "string" ||
    message.length > MAX_SIGNATURE_PAYLOAD_CHARS ||
    !HEX_RE.test(message) ||
    stripHexPrefix(message).length % 2 !== 0
  ) {
    throw invalidResponse("Invalid Trezor message bytes.");
  }
  return stripHexPrefix(message);
}

export function normalizeOptionalHash(
  hash: string | undefined,
): string | undefined {
  if (hash === undefined) return undefined;
  const normalized = stripHexPrefix(hash);
  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    throw invalidResponse("Invalid Trezor typed-data hash.");
  }
  return normalized;
}

type SuccessfulPayload<T> = T extends {
  success: true;
  payload: infer Payload;
}
  ? Payload
  : never;

export function unwrapTrezorResponse<
  Response extends { success: boolean; payload?: unknown; error?: unknown },
>(response: Response): SuccessfulPayload<Response> {
  if (response.success) {
    return response.payload as SuccessfulPayload<Response>;
  }
  throw response.error ?? response.payload ?? invalidResponse("Trezor returned an invalid response.");
}

function isQuantity(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 66 &&
    QUANTITY_RE.test(value)
  );
}

function isBoundedHex(value: unknown, maxChars: number): value is string {
  return (
    typeof value === "string" &&
    value.length >= 2 &&
    value.length <= maxChars &&
    HEX_RE.test(value) &&
    stripHexPrefix(value).length % 2 === 0
  );
}

function stripHexPrefix(value: string): string {
  return value.startsWith("0x") ? value.slice(2) : value;
}

function ensureHexPrefix(value: string): `0x${string}` {
  return (value.startsWith("0x") ? value : `0x${value}`) as `0x${string}`;
}

function invalidResponse(message: string): TrezorError {
  return new TrezorError(TrezorErrorCode.INVALID_RESPONSE, message);
}

function normalizeDeviceText(value: unknown, fallback: string): string {
  if (value === null || value === undefined || value === "") return fallback;
  if (
    typeof value !== "string" ||
    value.length > 64 ||
    !SAFE_DEVICE_TEXT_RE.test(value) ||
    value.trim() !== value
  ) {
    throw invalidResponse("Trezor returned invalid device metadata.");
  }
  return value;
}
