import { getAddress, isAddress } from "viem";
import type { TrezorAccount, TrezorDevice } from "../types";
import { isReleasedTrezorPath } from "./derivation";

const MAX_DEVICE_TEXT_CHARS = 64;
const SAFE_DEVICE_TEXT_RE = /^[^\p{Cc}]+$/u;

export type TrezorDeviceMap = Record<string, TrezorDevice>;

export function decodeTrezorDeviceMap(value: unknown): TrezorDeviceMap {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid Trezor device storage.");
  }
  const entries = Object.entries(value);
  if (entries.length > 1_000) {
    throw new Error("Too many stored Trezor devices.");
  }
  return Object.fromEntries(
    entries.map(([deviceId, device]) => {
      const normalizedDeviceId = normalizeTrezorDeviceId(deviceId);
      if (!device || typeof device !== "object" || Array.isArray(device)) {
        throw new Error("Invalid Trezor device storage.");
      }
      const row = device as Record<string, unknown>;
      const addedAt = row.addedAt;
      if (
        Object.keys(row).some(
          (key) => key !== "label" && key !== "model" && key !== "addedAt",
        ) ||
        typeof row.label !== "string" ||
        row.label.length < 1 ||
        row.label.length > MAX_DEVICE_TEXT_CHARS ||
        !SAFE_DEVICE_TEXT_RE.test(row.label) ||
        typeof row.model !== "string" ||
        row.model.length < 1 ||
        row.model.length > MAX_DEVICE_TEXT_CHARS ||
        !SAFE_DEVICE_TEXT_RE.test(row.model) ||
        !Number.isSafeInteger(addedAt) ||
        (addedAt as number) < 0
      ) {
        throw new Error("Invalid Trezor device storage.");
      }
      return [
        normalizedDeviceId,
        {
          label: row.label,
          model: row.model,
          addedAt: addedAt as number,
        } satisfies TrezorDevice,
      ];
    }),
  );
}

export function decodeTrezorAccount(value: unknown): TrezorAccount {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid Trezor account storage.");
  }
  const row = value as Record<string, unknown>;
  const expectedKeys = new Set([
    "address",
    "createdAt",
    "deviceId",
    "displayName",
    "hdIndex",
    "hdPath",
    "id",
    "type",
  ]);
  if (
    Object.keys(row).some((key) => !expectedKeys.has(key)) ||
    typeof row.id !== "string" ||
    row.id.length < 1 ||
    row.id.length > 128 ||
    row.type !== "trezor" ||
    typeof row.address !== "string" ||
    !isAddress(row.address) ||
    typeof row.deviceId !== "string" ||
    typeof row.hdPath !== "string" ||
    typeof row.hdIndex !== "number" ||
    !isReleasedTrezorPath(row.hdPath, row.hdIndex) ||
    (row.displayName !== undefined &&
      (typeof row.displayName !== "string" ||
        // Match accountStateRouter's released rename contract, including clear.
        row.displayName.length > 100)) ||
    typeof row.createdAt !== "number" ||
    !Number.isSafeInteger(row.createdAt) ||
    row.createdAt < 0
  ) {
    throw new Error("Invalid Trezor account storage.");
  }
  return {
    id: row.id,
    type: "trezor",
    address: getAddress(row.address),
    deviceId: normalizeTrezorDeviceId(row.deviceId),
    hdPath: row.hdPath,
    hdIndex: row.hdIndex,
    ...(row.displayName === undefined ? {} : { displayName: row.displayName }),
    createdAt: row.createdAt,
  };
}

export function normalizeTrezorDeviceId(value: string): string {
  if (!isAddress(value)) throw new Error("Invalid Trezor device identity.");
  return getAddress(value).toLowerCase();
}

export function normalizeTrezorDeviceText(
  value: string,
  fallback: string,
): string {
  const normalized = value.trim();
  if (normalized === "") return fallback;
  if (
    normalized.length > MAX_DEVICE_TEXT_CHARS ||
    !SAFE_DEVICE_TEXT_RE.test(normalized)
  ) {
    throw new Error("Invalid Trezor device metadata.");
  }
  return normalized;
}
