import type { HardwareWalletFlowProvider } from "@/components/HardwareWallet/types";
import {
  connectHidDevice,
  ledgerHardwareWalletProvider,
  scan,
} from "@/components/Ledger/ledgerFlowAdapter";
import type { LedgerDerivationScheme } from "@/components/Ledger/ledgerDerivation";
import { KEYCARD_SHELL_HARDWARE_WALLET_BRAND } from "./keycardShellBrand";

// Keycard Shell USB IDs, from @choppu/shelljs HID framing.
const SHELL_HID_FILTER = { vendorId: 0x1209, productId: 0x21f7 };
const ledger = ledgerHardwareWalletProvider;


/** Keycard Shell rides the Ledger WebHID pipeline; only discovery, routing and copy differ. */
export const keycardShellHardwareWalletProvider: HardwareWalletFlowProvider<LedgerDerivationScheme> = {
  ...ledger,
  name: "Keycard Shell",
  brand: KEYCARD_SHELL_HARDWARE_WALLET_BRAND,
  defaultScheme: "bip44",
  copy: {
    ...ledger.copy,
    initialStatus: "Plug in your Keycard Shell over USB and unlock it.",
    connectedStatus: "Keycard Shell connected. Select the accounts you want to add.",
    addingStatus: "Adding Keycard Shell accounts…",
    connectError: "Could not connect to Keycard Shell.",
    scanError: "Could not read Keycard Shell addresses.",
    addError: "Could not add Keycard Shell accounts.",
    statusLabels: {
      connecting: "Connecting to Keycard Shell…",
      "awaiting-app": "Unlock your Keycard Shell…",
      scanning: "Reading addresses from your Keycard Shell…",
      "awaiting-confirmation": "Review and approve on your Keycard Shell…",
      signing: "Waiting for your Keycard Shell…",
    },
    devicePanel: {
      ...ledger.copy.devicePanel,
      connectedDescription: "Keycard Shell is ready.",
      readyStatusDescription: "Device ready",
    },
  },
  operations: {
    ...ledger.operations,
    connect: (opId) => connectHidDevice(opId, SHELL_HID_FILTER, "keycardShell"),
    scan: (input) => scan(input, "keycardShell"),
  },
};
