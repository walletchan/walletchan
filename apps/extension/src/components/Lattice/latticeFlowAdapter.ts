import type {
  HardwareWalletAccountSelection,
  HardwareWalletAddressSelection,
  HardwareWalletDevice,
  HardwareWalletFlowProvider,
} from "@/components/HardwareWallet/types";
import { LATTICE_HARDWARE_WALLET_BRAND } from "./latticeBrand";
import {
  LATTICE_DERIVATION_OPTIONS,
  type LatticeDerivationScheme,
} from "./latticeDerivation";

const STATUS_LABELS: Readonly<Record<string, string>> = {
  connecting: "Connecting to your Lattice…",
  "awaiting-pairing": "Enter the pairing code shown on your Lattice.",
  scanning: "Reading addresses from your Lattice…",
  "awaiting-confirmation": "Approve the request on your Lattice…",
};

export interface LatticeConnectionInput {
  relayDeviceId: string;
  endpoint: string;
}

export interface LatticeFlowDependencies {
  /** Current connection form values. */
  getConnection(): LatticeConnectionInput;
  /** Resolves with the code typed by the user, or rejects when they cancel. */
  requestPairingCode(): Promise<string>;
  onConnected(device: HardwareWalletDevice): void;
}

async function getExistingAccounts() {
  return new Promise<Array<{ type: string; address: string }>>((resolve) => {
    chrome.runtime.sendMessage(
      { type: "getAccounts" },
      (accounts: Array<{ type: string; address: string }> | undefined) => {
        resolve(accounts ?? []);
      },
    );
  });
}

function toDevice(response: Record<string, unknown>): HardwareWalletDevice {
  return {
    deviceId: String(response.deviceId),
    deviceLabel: String(response.deviceLabel),
    deviceModel: String(response.deviceModel),
  };
}

async function scan(input: {
  opId: string;
  deviceId: string;
  startIndex: number;
  count: number;
  scheme: LatticeDerivationScheme;
}): Promise<HardwareWalletAddressSelection[]> {
  const response = await chrome.runtime.sendMessage({ type: "latticeScan", ...input });
  if (!response?.success) {
    throw new Error(response?.error || "Could not read Lattice addresses.");
  }
  return response.addresses as HardwareWalletAddressSelection[];
}

async function commitAccounts(selection: HardwareWalletAccountSelection): Promise<void> {
  const response = await chrome.runtime.sendMessage({
    type: "addLatticeAccounts",
    deviceId: selection.deviceId,
    deviceLabel: selection.deviceLabel,
    addresses: selection.addresses.map(({ address }) => ({ address })),
  });
  if (!response?.success) {
    throw new Error(response?.error || "Could not add Lattice accounts.");
  }
}

function subscribeStatus(opId: string, onStatus: (status: string) => void): () => void {
  const listener = (message: { type?: string; opId?: string; status?: string }) => {
    if (message.type === "latticeStatus" && message.opId === opId && message.status) {
      onStatus(message.status);
    }
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}

async function cancel(opId: string): Promise<void> {
  await chrome.runtime.sendMessage({ type: "latticeCancel", opId });
}

export function createLatticeHardwareWalletProvider(
  dependencies: LatticeFlowDependencies,
): HardwareWalletFlowProvider<LatticeDerivationScheme> {
  const connect = async (opId: string): Promise<HardwareWalletDevice> => {
    const { relayDeviceId, endpoint } = dependencies.getConnection();
    if (!relayDeviceId.trim()) {
      throw new Error("Enter the device ID shown in your Lattice's settings.");
    }
    const response = await chrome.runtime.sendMessage({
      type: "latticeConnect",
      opId,
      relayDeviceId: relayDeviceId.trim(),
      endpoint: endpoint.trim() || null,
    });
    if (!response?.success) throw new Error(response?.error || "Could not connect to your Lattice.");
    let device: HardwareWalletDevice;
    if (response.needsPairing) {
      const pairingCode = await dependencies.requestPairingCode();
      const paired = await chrome.runtime.sendMessage({ type: "latticePair", opId, pairingCode });
      if (!paired?.success) throw new Error(paired?.error || "Could not pair your Lattice.");
      device = toDevice(paired);
    } else {
      device = toDevice(response);
    }
    dependencies.onConnected(device);
    return device;
  };

  return {
    name: "Lattice",
    brand: LATTICE_HARDWARE_WALLET_BRAND,
    defaultScheme: "bip44",
    derivationOptions: LATTICE_DERIVATION_OPTIONS,
    copy: {
      initialStatus: "Unlock your Lattice and connect it to Wi-Fi.",
      connectedStatus: "Lattice connected. Select the accounts you want to add.",
      addingStatus: "Adding Lattice accounts…",
      connectError: "Could not connect to your Lattice.",
      scanError: "Could not read Lattice addresses.",
      addError: "Could not add Lattice accounts.",
      statusLabels: STATUS_LABELS,
      devicePanel: {
        connectedDescription: "Your Lattice is paired with WalletChan.",
        readyStatusDescription: "Paired and ready",
        disconnectedDescription:
          "WalletChan stores public addresses, paths and an encrypted pairing key. Your keys stay on the device.",
        disconnectedStatusDescription: "Enter the device ID from your Lattice, then connect.",
      },
    },
    operations: {
      getExistingAccounts,
      connect,
      scan,
      commitAccounts,
      subscribeStatus,
      cancel,
    },
  };
}
