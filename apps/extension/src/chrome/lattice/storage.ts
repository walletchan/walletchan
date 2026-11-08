import { getAddress, isAddress } from "viem";
import type { LatticeAccount, LatticeDevice } from "../types";
import { assertAccountStorageAuthorized } from "../accounts/authorization";
import {
  ACCOUNTS_LOCK_KEY,
  ACCOUNTS_STORAGE_KEY,
  getAccounts,
  normalizeEvmAccountAddress,
} from "../accounts/repository";
import { setActiveAccountId } from "../accounts/selectionStorage";
import { withStorageLock } from "../storageLock";
import { isValidBip32Path } from "../../lib/bip32Path";
import { LATTICE_APP_KEY_STORAGE_KEY, type StoredLatticeAppKey } from "./appKeyRecord";
import { isValidLatticeDeviceId, normalizeLatticeRelayUrl } from "./protocol";

export const LATTICE_DEVICES_STORAGE_KEY = "latticeDevices";

export type LatticeDeviceMap = Record<string, LatticeDevice>;

export interface LatticeAddressInput {
  address: string;
  hdPath: string;
  hdIndex: number;
  displayName?: string;
}

function decodeDevice(value: unknown): LatticeDevice | null {
  const row = value as Partial<LatticeDevice> | null;
  if (
    !row || typeof row.label !== "string" || typeof row.model !== "string" || typeof row.addedAt !== "number" ||
    typeof row.relayDeviceId !== "string" || !isValidLatticeDeviceId(row.relayDeviceId) ||
    (row.endpoint !== null && typeof row.endpoint !== "string") ||
    typeof row.walletUid !== "string" || !/^0x[0-9a-f]{64}$/.test(row.walletUid) ||
    (row.walletKind !== "internal" && row.walletKind !== "safecard")
  ) return null;
  const { label, model, addedAt, relayDeviceId, endpoint, walletUid, walletKind } = row as LatticeDevice;
  return { label, model, addedAt, relayDeviceId, endpoint, walletUid, walletKind };
}

/** Public Lattice metadata keyed by canonical address; malformed rows are dropped. */
export async function getLatticeDevices(): Promise<LatticeDeviceMap> {
  const result = await chrome.storage.local.get(LATTICE_DEVICES_STORAGE_KEY);
  const raw = result[LATTICE_DEVICES_STORAGE_KEY];
  const out: LatticeDeviceMap = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [deviceId, value] of Object.entries(raw as Record<string, unknown>)) {
    const device = decodeDevice(value);
    if (device && isAddress(deviceId)) out[deviceId.toLowerCase()] = device;
  }
  return out;
}

export interface AddLatticeAccountsInput {
  deviceId: string;
  deviceLabel: string;
  deviceModel: string;
  relayDeviceId: string;
  endpoint: string | null;
  walletUid: string;
  walletKind: "internal" | "safecard";
  addresses: LatticeAddressInput[];
  /** Present only when setup paired a newly generated key that must be persisted. */
  newAppKey: StoredLatticeAppKey | null;
}

export async function addLatticeAccounts(
  input: AddLatticeAccountsInput,
  expectedAuthEpoch: string,
): Promise<LatticeAccount[]> {
  const created = await withStorageLock(ACCOUNTS_LOCK_KEY, async () => {
    assertAccountStorageAuthorized(expectedAuthEpoch);
    const deviceId = normalizeDeviceId(input.deviceId);
    if (!isValidLatticeDeviceId(input.relayDeviceId)) throw new Error("Invalid Lattice device ID.");
    const endpoint = input.endpoint === null ? null : normalizeLatticeRelayUrl(input.endpoint);
    if (!/^0x[0-9a-f]{64}$/.test(input.walletUid)) throw new Error("Invalid Lattice wallet identity.");
    if (input.addresses.length < 1 || input.addresses.length > 20) {
      throw new Error("Select between 1 and 20 Lattice accounts.");
    }
    const [accounts, stored] = await Promise.all([
      getAccounts(),
      chrome.storage.local.get(LATTICE_APP_KEY_STORAGE_KEY),
    ]);
    const hasStoredKey = stored[LATTICE_APP_KEY_STORAGE_KEY] !== undefined && stored[LATTICE_APP_KEY_STORAGE_KEY] !== null;
    if (input.newAppKey && hasStoredKey) {
      throw new Error("Lattice setup changed while pairing. Start again.");
    }
    if (!input.newAppKey && !hasStoredKey) {
      throw new Error("The Lattice pairing key is missing. Start again.");
    }
    const existingAddresses = new Set(
      accounts.filter((account) => account.type !== "impersonator").map((account) => account.address.toLowerCase()),
    );
    const selectedAddresses = new Set<string>();
    const created = input.addresses.map((entry): LatticeAccount => {
      if (!isAddress(entry.address) || !isValidBip32Path(entry.hdPath)) {
        throw new Error("Invalid Lattice account details.");
      }
      if (!Number.isSafeInteger(entry.hdIndex) || entry.hdIndex < 0) {
        throw new Error("Invalid Lattice derivation index.");
      }
      const checksummedAddress = getAddress(entry.address);
      const normalized = normalizeEvmAccountAddress(checksummedAddress);
      if (existingAddresses.has(normalized) || selectedAddresses.has(normalized)) {
        throw new Error(`${checksummedAddress} is already in this wallet.`);
      }
      selectedAddresses.add(normalized);
      return {
        id: crypto.randomUUID(), type: "lattice", address: checksummedAddress, deviceId,
        hdPath: entry.hdPath, hdIndex: entry.hdIndex,
        displayName: entry.displayName?.trim().slice(0, 64) || undefined,
        createdAt: Date.now(),
      };
    });
    const devices = await getLatticeDevices();
    devices[deviceId] = {
      label: sanitizeLabel(input.deviceLabel, "Lattice1"),
      model: sanitizeLabel(input.deviceModel, "Lattice1"),
      addedAt: devices[deviceId]?.addedAt ?? Date.now(),
      relayDeviceId: input.relayDeviceId,
      endpoint,
      walletUid: input.walletUid,
      walletKind: input.walletKind,
    };
    assertAccountStorageAuthorized(expectedAuthEpoch);
    // One write: accounts, device row and (for a first pairing) the encrypted key.
    await chrome.storage.local.set({
      [ACCOUNTS_STORAGE_KEY]: [...accounts, ...created],
      [LATTICE_DEVICES_STORAGE_KEY]: devices,
      ...(input.newAppKey ? { [LATTICE_APP_KEY_STORAGE_KEY]: input.newAppKey } : {}),
    });
    return created;
  });
  await setActiveAccountId(created[0].id, expectedAuthEpoch).catch((error) => {
    console.warn("[lattice] Failed to select newly added Lattice account:", error);
  });
  return created;
}

/** Drops a device row with no accounts left, and the pairing key with the last device. */
export async function removeLatticeDeviceIfUnused(
  deviceId: string,
  expectedAuthEpoch?: string,
): Promise<void> {
  await withStorageLock(ACCOUNTS_LOCK_KEY, async () => {
    const accounts = await getAccounts();
    const latticeAccounts = accounts.filter((account) => account.type === "lattice");
    if (latticeAccounts.some((account) => account.deviceId === deviceId)) return;
    const devices = await getLatticeDevices();
    const removeDevice = deviceId in devices;
    if (removeDevice) delete devices[deviceId];
    const removeKey = latticeAccounts.length === 0;
    if (!removeDevice && !removeKey) return;
    assertAccountStorageAuthorized(expectedAuthEpoch);
    if (removeDevice) await chrome.storage.local.set({ [LATTICE_DEVICES_STORAGE_KEY]: devices });
    if (removeKey) await chrome.storage.local.remove(LATTICE_APP_KEY_STORAGE_KEY);
  });
}

function normalizeDeviceId(value: string): string {
  if (!isAddress(value)) throw new Error("Invalid Lattice device identity.");
  return getAddress(value).toLowerCase();
}

function sanitizeLabel(value: string, fallback: string): string {
  return Array.from(value).filter((ch) => ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) !== 0x7f).join("").trim().slice(0, 64) || fallback;
}
