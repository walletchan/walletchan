import type {
  HardwareWalletAccountSelection,
  HardwareWalletAddressSelection,
  HardwareWalletDevice,
  HardwareWalletFlowProvider,
} from "@/components/HardwareWallet/types";
import { LEDGER_HARDWARE_WALLET_BRAND } from "./ledgerBrand";
import {
  LEDGER_DERIVATION_OPTIONS,
  type LedgerDerivationScheme,
} from "./ledgerDerivation";

const STATUS_LABELS: Readonly<Record<string, string>> = {
  connecting: "Connecting to Ledger…",
  "awaiting-app": "Open the Ethereum app on your Ledger…",
  scanning: "Reading addresses from your Ledger…",
  "awaiting-confirmation": "Review and approve on your Ledger…",
  signing: "Waiting for your Ledger…",
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
  const hid = (
    navigator as Navigator & {
      hid?: {
        requestDevice(options: {
          filters: Array<{ vendorId: number }>;
        }): Promise<Array<{ productName?: string }>>;
      };
    }
  ).hid;
  if (!hid) throw new Error("Ledger support requires Chrome 124 or newer.");
  const chosen = await hid.requestDevice({
    filters: [{ vendorId: 0x2c97 }],
  });
  if (!chosen.length) throw new Error("No Ledger device selected.");
  const response = await chrome.runtime.sendMessage({
    type: "ledgerConnect",
    opId,
    productName: chosen[0].productName,
  });
  if (!response?.success) {
    throw new Error(response?.error || "Could not connect to Ledger.");
  }
  return response as HardwareWalletDevice & { success: true };
}

async function scan(input: {
  opId: string;
  deviceId: string;
  startIndex: number;
  count: number;
  scheme: LedgerDerivationScheme;
}): Promise<HardwareWalletAddressSelection[]> {
  const response = await chrome.runtime.sendMessage({
    type: "ledgerScan",
    ...input,
  });
  if (!response?.success) {
    throw new Error(response?.error || "Could not read Ledger addresses.");
  }
  return response.addresses as HardwareWalletAddressSelection[];
}

async function commitAccounts(
  selection: HardwareWalletAccountSelection,
): Promise<void> {
  const response = await chrome.runtime.sendMessage({
    type: "addLedgerAccounts",
    ...selection,
  });
  if (!response?.success) {
    throw new Error(response?.error || "Could not add Ledger accounts.");
  }
}

function subscribeStatus(
  opId: string,
  onStatus: (status: string) => void,
): () => void {
  const listener = (message: {
    type?: string;
    opId?: string;
    status?: string;
  }) => {
    if (
      message.type === "offscreenLedgerStatus" &&
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
  await chrome.runtime.sendMessage({ type: "ledgerCancel", opId });
}

export const ledgerHardwareWalletProvider: HardwareWalletFlowProvider<LedgerDerivationScheme> =
  {
    name: "Ledger",
    brand: LEDGER_HARDWARE_WALLET_BRAND,
    defaultScheme: "ledgerLive",
    derivationOptions: LEDGER_DERIVATION_OPTIONS,
    copy: {
      initialStatus: "Unlock your Ledger.",
      connectedStatus: "Ledger connected. Select the accounts you want to add.",
      addingStatus: "Adding Ledger accounts…",
      connectError: "Could not connect to Ledger.",
      scanError: "Could not read Ledger addresses.",
      addError: "Could not add Ledger accounts.",
      statusLabels: STATUS_LABELS,
      devicePanel: {
        connectedDescription: "The Ethereum app is ready.",
        readyStatusDescription: "Ethereum app ready",
        disconnectedDescription:
          "WalletChan stores public addresses and paths only. Your keys stay on the device.",
        disconnectedStatusDescription: "Open the Ethereum app, then allow USB access.",
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
