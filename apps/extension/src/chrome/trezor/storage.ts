import { getAddress, isAddress } from "viem";
import type { Account, TrezorAccount } from "../types";
import { assertAccountStorageAuthorized } from "../accounts/authorization";
import {
  ACCOUNTS_LOCK_KEY,
  ACCOUNTS_STORAGE_KEY,
  getAccounts,
  normalizeEvmAccountAddress,
} from "../accounts/repository";
import { setActiveAccountId } from "../accounts/selectionStorage";
import { withStorageLock } from "../storageLock";
import { isReleasedTrezorPath } from "./derivation";
import {
  decodeTrezorAccount,
  decodeTrezorDeviceMap,
  normalizeTrezorDeviceId,
  normalizeTrezorDeviceText,
  type TrezorDeviceMap,
} from "./codecs";

export {
  decodeTrezorAccount,
  decodeTrezorDeviceMap,
  normalizeTrezorDeviceId,
} from "./codecs";
export type { TrezorDeviceMap } from "./codecs";

export const TREZOR_DEVICES_STORAGE_KEY = "trezorDevices";
const MAX_TREZOR_ACCOUNTS_PER_IMPORT = 20;

export interface TrezorAddressInput {
  address: string;
  hdPath: string;
  hdIndex: number;
  displayName?: string;
}

export interface PreparedTrezorAccountImport {
  accounts: Account[];
  devices: TrezorDeviceMap;
  created: TrezorAccount[];
}

export async function getTrezorDevices(): Promise<TrezorDeviceMap> {
  const result = await chrome.storage.local.get(TREZOR_DEVICES_STORAGE_KEY);
  return decodeTrezorDeviceMap(result[TREZOR_DEVICES_STORAGE_KEY]);
}

export async function addTrezorAccounts(
  input: {
    deviceId: string;
    deviceLabel: string;
    deviceModel: string;
    addresses: TrezorAddressInput[];
  },
  expectedAuthEpoch: string,
): Promise<TrezorAccount[]> {
  const created = await withStorageLock(ACCOUNTS_LOCK_KEY, async () => {
    assertAccountStorageAuthorized(expectedAuthEpoch);
    const deviceId = normalizeTrezorDeviceId(input.deviceId);
    const label = normalizeTrezorDeviceText(input.deviceLabel, "Trezor");
    const model = normalizeTrezorDeviceText(input.deviceModel, "Trezor");
    if (
      input.addresses.length < 1 ||
      input.addresses.length > MAX_TREZOR_ACCOUNTS_PER_IMPORT
    ) {
      throw new Error("Select between 1 and 20 Trezor accounts.");
    }

    const now = Date.now();
    const accounts = await getAccounts();
    const devices = await getTrezorDevices();
    const prepared = prepareTrezorAccountImport({
      input: {
        ...input,
        deviceId,
        deviceLabel: label,
        deviceModel: model,
      },
      accounts,
      devices,
      now,
      createId: () => crypto.randomUUID(),
    });

    assertAccountStorageAuthorized(expectedAuthEpoch);
    await chrome.storage.local.set({
      [ACCOUNTS_STORAGE_KEY]: prepared.accounts,
      [TREZOR_DEVICES_STORAGE_KEY]: prepared.devices,
    });
    return prepared.created;
  });

  await setActiveAccountId(created[0].id, expectedAuthEpoch).catch((error) => {
    console.warn("[trezor] Failed to select newly added Trezor account:", error);
  });
  return created;
}

export function prepareTrezorAccountImport(input: {
  input: {
    deviceId: string;
    deviceLabel: string;
    deviceModel: string;
    addresses: TrezorAddressInput[];
  };
  accounts: readonly Account[];
  devices: TrezorDeviceMap;
  now: number;
  createId: () => string;
}): PreparedTrezorAccountImport {
  if (!Number.isSafeInteger(input.now) || input.now < 0) {
    throw new Error("Invalid Trezor import time.");
  }
  const deviceId = normalizeTrezorDeviceId(input.input.deviceId);
  const label = normalizeTrezorDeviceText(
    input.input.deviceLabel,
    "Trezor",
  );
  const model = normalizeTrezorDeviceText(
    input.input.deviceModel,
    "Trezor",
  );
  if (
    input.input.addresses.length < 1 ||
    input.input.addresses.length > MAX_TREZOR_ACCOUNTS_PER_IMPORT
  ) {
    throw new Error("Select between 1 and 20 Trezor accounts.");
  }
  const existingAddresses = new Set(
    input.accounts
      .filter((account) => account.type !== "impersonator")
      .map((account) => normalizeEvmAccountAddress(account.address)),
  );
  const selectedAddresses = new Set<string>();
  const created = input.input.addresses.map((entry): TrezorAccount => {
    if (
      !isAddress(entry.address) ||
      !isReleasedTrezorPath(entry.hdPath, entry.hdIndex)
    ) {
      throw new Error("Invalid Trezor account details.");
    }
    const checksummedAddress = getAddress(entry.address);
    const normalized = normalizeEvmAccountAddress(checksummedAddress);
    if (existingAddresses.has(normalized) || selectedAddresses.has(normalized)) {
      throw new Error(`${checksummedAddress} is already in this wallet.`);
    }
    selectedAddresses.add(normalized);
    return decodeTrezorAccount({
      id: input.createId(),
      type: "trezor",
      address: checksummedAddress,
      deviceId,
      hdPath: entry.hdPath,
      hdIndex: entry.hdIndex,
      ...(entry.displayName?.trim()
        ? { displayName: entry.displayName.trim().slice(0, 64) }
        : {}),
      createdAt: input.now,
    });
  });
  return {
    accounts: [...input.accounts, ...created],
    devices: {
      ...input.devices,
      [deviceId]: {
        label,
        model,
        addedAt: input.devices[deviceId]?.addedAt ?? input.now,
      },
    },
    created,
  };
}

export async function removeTrezorDeviceIfUnused(
  deviceId: string,
  expectedAuthEpoch?: string,
): Promise<void> {
  await withStorageLock(ACCOUNTS_LOCK_KEY, async () => {
    const normalizedDeviceId = normalizeTrezorDeviceId(deviceId);
    const accounts = await getAccounts();
    if (
      accounts.some(
        (account) =>
          account.type === "trezor" &&
          account.deviceId === normalizedDeviceId,
      )
    ) {
      return;
    }
    const devices = await getTrezorDevices();
    if (!(normalizedDeviceId in devices)) return;
    delete devices[normalizedDeviceId];
    assertAccountStorageAuthorized(expectedAuthEpoch);
    await chrome.storage.local.set({ [TREZOR_DEVICES_STORAGE_KEY]: devices });
  });
}
