import { handleUnlockWallet } from "../authHandlers";
import { getAuthCeremonyEpoch } from "../authTransition";
import { resolvePasswordType } from "../sessionCache";
import {
  WALLET_SECRET_OPERATION_LOCK_KEY,
  withStorageLock,
} from "../storageLock";
import {
  cancelTrezorOperation,
  connectTrezor,
  scanTrezorAddresses,
} from "./offscreenBridge";
import {
  addTrezorAccounts,
  getTrezorDevices,
  type TrezorAddressInput,
} from "./storage";
import type { TrezorDerivationScheme } from "./derivation";

const SCHEMES = new Set<TrezorDerivationScheme>([
  "standard",
  "account",
  "legacy",
]);

export async function handleTrezorConnect(message: Record<string, unknown>) {
  requireTrezorSupport();
  return connectTrezor(requireString(message.opId, "operation ID"));
}

export async function handleTrezorScan(message: Record<string, unknown>) {
  requireTrezorSupport();
  const scheme = requireString(message.scheme, "derivation scheme");
  if (!SCHEMES.has(scheme as TrezorDerivationScheme)) {
    throw new Error("Invalid Trezor derivation scheme.");
  }
  return scanTrezorAddresses({
    opId: requireString(message.opId, "operation ID"),
    deviceId: requireString(message.deviceId, "device ID"),
    startIndex: requireInteger(message.startIndex, "start index", 0, 0x7fffffff),
    count: requireInteger(message.count, "address count", 1, 20),
    scheme: scheme as TrezorDerivationScheme,
  });
}

export async function handleAddTrezorAccounts(
  message: Record<string, unknown>,
) {
  requireTrezorSupport();
  const passwordType = await resolvePasswordType(handleUnlockWallet);
  if (passwordType !== "master") {
    throw new Error("Adding accounts requires master password");
  }
  const expectedAuthEpoch = getAuthCeremonyEpoch();
  if (!Array.isArray(message.addresses)) {
    throw new Error("No Trezor accounts selected.");
  }
  const input = {
    deviceId: requireString(message.deviceId, "device ID"),
    deviceLabel: requireString(message.deviceLabel, "device label"),
    deviceModel: requireString(message.deviceModel, "device model"),
    addresses: message.addresses.map((value) => {
      if (!value || typeof value !== "object") {
        throw new Error("Invalid Trezor account.");
      }
      const item = value as Record<string, unknown>;
      return {
        address: requireString(item.address, "address"),
        hdPath: requireString(item.hdPath, "derivation path"),
        hdIndex: requireInteger(
          item.hdIndex,
          "derivation index",
          0,
          0x7fffffff,
        ),
        displayName:
          typeof item.displayName === "string"
            ? item.displayName
            : undefined,
      } satisfies TrezorAddressInput;
    }),
  };
  const accounts = await withStorageLock(
    WALLET_SECRET_OPERATION_LOCK_KEY,
    () => addTrezorAccounts(input, expectedAuthEpoch),
  );
  void chrome.runtime
    .sendMessage({ type: "accountsUpdated" })
    .catch(() => undefined);
  return accounts;
}

export async function handleGetTrezorDevices() {
  requireTrezorSupport();
  return getTrezorDevices();
}

export async function handleTrezorCancel(message: Record<string, unknown>) {
  requireTrezorSupport();
  const cancelled = await cancelTrezorOperation(
    requireString(message.opId, "operation ID"),
  );
  return { success: true, cancelled };
}

function requireTrezorSupport(): void {
  if (!chrome.runtime.onMessageExternal || !chrome.tabs || !chrome.windows) {
    throw new Error("Trezor support is only available in Chrome.");
  }
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing ${name}.`);
  }
  return value.trim().slice(0, 256);
}

function requireInteger(
  value: unknown,
  name: string,
  min: number,
  max: number,
): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new Error(`Invalid ${name}.`);
  }
  return number;
}
