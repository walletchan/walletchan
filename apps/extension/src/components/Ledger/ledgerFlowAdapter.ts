import type {
  HardwareWalletAccountSelection,
  HardwareWalletAddressSelection,
  HardwareWalletDevice,
  HardwareWalletFlowProvider,
} from "@/components/HardwareWallet/types";
import { keycardShellMessage, normalizeLedgerError } from "@/chrome/ledger/errors";
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
  return connectHidDevice(opId, { vendorId: 0x2c97 });
}

/** Grants WebHID access from this visible tab, then connects in the shared offscreen signer. */
export async function connectHidDevice(
  opId: string,
  filter: { vendorId: number; productId?: number },
  vendor?: "keycardShell",
): Promise<HardwareWalletDevice> {
  const name = vendor === "keycardShell" ? "Keycard Shell" : "Ledger";
  const hid = (
    navigator as Navigator & {
      hid?: {
        requestDevice(options: {
          filters: Array<{ vendorId: number; productId?: number }>;
        }): Promise<Array<{ productName?: string }>>;
      };
    }
  ).hid;
  if (!hid) throw new Error(`${name} support requires Chrome 124 or newer.`);
  // A dismissed chooser gives [] or NotFoundError; any other rejection is a real failure (policy, no user gesture).
  const chosen = await hid.requestDevice({ filters: [filter] }).catch((error: unknown) => {
    console.warn(`[${name}] WebHID device request failed:`, error);
    if ((error as { name?: unknown })?.name === "NotFoundError") return [];
    const { userMessage } = normalizeLedgerError(error);
    throw new Error(vendor === "keycardShell" ? keycardShellMessage(userMessage) : userMessage);
  });
  if (!chosen.length) throw new Error("No device selected.");
  const response = await chrome.runtime.sendMessage({
    type: "ledgerConnect",
    opId,
    productName: chosen[0].productName,
    vendor,
  });
  if (!response?.success) {
    throw new Error(response?.error || `Could not connect to ${name}.`);
  }
  return response as HardwareWalletDevice & { success: true };
}

export async function scan(input: {
  opId: string;
  deviceId: string;
  startIndex: number;
  count: number;
  scheme: LedgerDerivationScheme;
}, vendor?: "keycardShell"): Promise<HardwareWalletAddressSelection[]> {
  const response = await chrome.runtime.sendMessage({
    type: "ledgerScan",
    ...input,
    vendor,
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
      scan: (input) => scan(input),
      commitAccounts,
      subscribeStatus,
      cancel,
    },
  };
