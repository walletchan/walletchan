import { addLatticeAccounts, getLatticeDevices, type LatticeAddressInput } from "./storage";
import {
  cancelLatticeOperation,
  clearLatticeSetup,
  connectLatticeForSetup,
  getLatticeSetupForCommit,
  pairLatticeForSetup,
  scanLatticeAddresses,
} from "./operations";
import { encryptLatticeAppKey } from "./appKeyVault";
import { isLatticeDerivationScheme } from "./derivation";
import { requireInteger, requireString } from "../ledger/accountHandlers";
import { handleUnlockWallet } from "../authHandlers";
import { getAuthCeremonyEpoch } from "../authTransition";
import { getCachedVaultKey, resolvePasswordType } from "../sessionCache";
import {
  WALLET_SECRET_OPERATION_LOCK_KEY,
  withStorageLock,
} from "../storageLock";

export async function handleLatticeConnect(message: Record<string, unknown>) {
  return connectLatticeForSetup({
    opId: requireString(message.opId, "operation ID"),
    relayDeviceId: requireString(message.relayDeviceId, "device ID"),
    endpoint: typeof message.endpoint === "string" ? message.endpoint.slice(0, 512) : null,
  });
}

export async function handleLatticePair(message: Record<string, unknown>) {
  return pairLatticeForSetup({
    opId: requireString(message.opId, "operation ID"),
    pairingCode: message.pairingCode,
  });
}

export async function handleLatticeScan(message: Record<string, unknown>) {
  const scheme = message.scheme;
  if (!isLatticeDerivationScheme(scheme)) throw new Error("Invalid Lattice derivation scheme.");
  return scanLatticeAddresses({
    opId: requireString(message.opId, "operation ID"),
    deviceId: requireString(message.deviceId, "device ID"),
    startIndex: requireInteger(message.startIndex, "start index", 0, 0x7fffffff),
    count: requireInteger(message.count, "address count", 1, 20),
    scheme,
  });
}

/**
 * Commits selected Lattice accounts. Relay, wallet and path facts come from the
 * background setup session; the renderer only chooses addresses the device
 * already returned during this setup.
 */
export async function handleAddLatticeAccounts(message: Record<string, unknown>) {
  const passwordType = await resolvePasswordType(handleUnlockWallet);
  if (passwordType !== "master") {
    throw new Error("Adding accounts requires master password");
  }
  const expectedAuthEpoch = getAuthCeremonyEpoch();
  if (!Array.isArray(message.addresses)) throw new Error("No Lattice accounts selected.");
  const deviceId = requireString(message.deviceId, "device ID");
  const session = getLatticeSetupForCommit(deviceId);
  const addresses = message.addresses.map((value): LatticeAddressInput => {
    if (!value || typeof value !== "object") throw new Error("Invalid Lattice account.");
    const item = value as Record<string, unknown>;
    const address = requireString(item.address, "address");
    const scanned = session.resolveScanned(address);
    if (!scanned) throw new Error("Select addresses read during this setup.");
    return {
      address,
      hdPath: scanned.hdPath,
      hdIndex: scanned.hdIndex,
      displayName: typeof item.displayName === "string" ? item.displayName : undefined,
    };
  });
  const accounts = await withStorageLock(WALLET_SECRET_OPERATION_LOCK_KEY, async () => {
    let newAppKey = null;
    if (session.appKeyIsNew) {
      const vaultKey = getCachedVaultKey();
      if (!vaultKey) throw new Error("Unlock WalletChan first.");
      newAppKey = await encryptLatticeAppKey(vaultKey, session.appKey);
    }
    return addLatticeAccounts(
      {
        deviceId,
        deviceLabel: typeof message.deviceLabel === "string" ? message.deviceLabel : "Lattice1",
        deviceModel: "Lattice1",
        relayDeviceId: session.relayDeviceId,
        endpoint: session.endpoint,
        walletUid: session.walletUid,
        walletKind: session.walletKind,
        addresses,
        newAppKey,
      },
      expectedAuthEpoch,
    );
  });
  clearLatticeSetup();
  void chrome.runtime.sendMessage({ type: "accountsUpdated" }).catch(() => undefined);
  return accounts;
}

export async function handleGetLatticeDevices() {
  return getLatticeDevices();
}

export async function handleLatticeCancel(message: Record<string, unknown>) {
  await cancelLatticeOperation(requireString(message.opId, "operation ID"));
  return { success: true };
}

/** Handlers bound for `createBackgroundLatticeMessageRouter`. */
export const LATTICE_ROUTER_DEPENDENCIES = {
  handleLatticeConnect,
  handleLatticePair,
  handleLatticeScan,
  handleLatticeCancel,
  handleAddLatticeAccounts,
  handleGetLatticeDevices,
};
