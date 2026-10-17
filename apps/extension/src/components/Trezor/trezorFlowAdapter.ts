import type {
  HardwareWalletAccountSelection,
  HardwareWalletAddressSelection,
  HardwareWalletDevice,
  HardwareWalletFlowProvider,
} from "@/components/HardwareWallet/types";
import type { TrezorDerivationScheme } from "@/chrome/trezor/derivation";
import { TREZOR_HARDWARE_WALLET_BRAND } from "./trezorBrand";
import { TREZOR_DERIVATION_OPTIONS } from "./trezorDerivation";

const STATUS_LABELS: Readonly<Record<string, string>> = {
  connecting: "Connecting to Trezor…",
  "selecting-device": "Choose your Trezor…",
  "awaiting-confirmation": "Review and approve with your Trezor…",
  scanning: "Reading addresses from your Trezor…",
  signing: "Waiting for your Trezor…",
};

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

async function connect(opId: string): Promise<HardwareWalletDevice> {
  const response = await chrome.runtime.sendMessage({
    type: "trezorConnect",
    opId,
  });
  if (!response?.success) {
    throw new Error(response?.error || "Could not connect to Trezor.");
  }
  return response as HardwareWalletDevice & { success: true };
}

async function scan(input: {
  opId: string;
  deviceId: string;
  startIndex: number;
  count: number;
  scheme: TrezorDerivationScheme;
}): Promise<HardwareWalletAddressSelection[]> {
  const response = await chrome.runtime.sendMessage({
    type: "trezorScan",
    ...input,
  });
  if (!response?.success) {
    throw new Error(response?.error || "Could not read Trezor addresses.");
  }
  return response.addresses as HardwareWalletAddressSelection[];
}

async function commitAccounts(
  selection: HardwareWalletAccountSelection,
): Promise<void> {
  const response = await chrome.runtime.sendMessage({
    type: "addTrezorAccounts",
    ...selection,
  });
  if (!response?.success) {
    throw new Error(response?.error || "Could not add Trezor accounts.");
  }
}

function subscribeStatus(
  opId: string,
  onStatus: (status: string) => void,
): () => void {
  const listener = (message: {
    type?: string;
    source?: string;
    opId?: string;
    status?: string;
  }) => {
    if (
      message.type === "trezorStatus" &&
      message.source === "walletchan-trezor-connect" &&
      message.opId === opId &&
      message.status
    ) {
      onStatus(message.status);
    }
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}

async function cancel(opId: string): Promise<void> {
  await chrome.runtime.sendMessage({ type: "trezorCancel", opId });
}

export const trezorHardwareWalletProvider: HardwareWalletFlowProvider<TrezorDerivationScheme> =
  {
    name: "Trezor",
    brand: TREZOR_HARDWARE_WALLET_BRAND,
    defaultScheme: "standard",
    derivationOptions: TREZOR_DERIVATION_OPTIONS,
    copy: {
      initialStatus: "Unlock your Trezor.",
      connectedStatus: "Trezor connected. Select the accounts you want to add.",
      addingStatus: "Adding Trezor accounts…",
      connectError: "Could not connect to Trezor.",
      scanError: "Could not read Trezor addresses.",
      addError: "Could not add Trezor accounts.",
      statusLabels: STATUS_LABELS,
      devicePanel: {
        connectedDescription:
          "Review and approve device actions in Trezor Suite.",
        readyStatusDescription: "Trezor ready",
        disconnectedDescription:
          "WalletChan stores public addresses and paths only. Your keys stay on the device.",
        disconnectedStatusDescription:
          "Approve the connection in Trezor Suite.",
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
