import { HardwareWalletDevicePanel } from "@/components/HardwareWallet/HardwareWalletDevicePanel";
import { LEDGER_HARDWARE_WALLET_BRAND } from "./ledgerBrand";

interface LedgerDevicePanelProps {
  device: {
    deviceLabel: string;
  } | null;
  busy: boolean;
  status: string;
}

export function LedgerDevicePanel({
  device,
  busy,
  status,
}: LedgerDevicePanelProps) {
  return (
    <HardwareWalletDevicePanel
      brand={LEDGER_HARDWARE_WALLET_BRAND}
      device={device}
      busy={busy}
      status={status}
      connectedDescription="The Ethereum app is ready."
      readyStatusDescription="Ethereum app ready"
      disconnectedDescription="WalletChan stores public addresses and paths only. Your keys stay on the device."
      disconnectedStatusDescription="Chrome will ask for USB access."
    />
  );
}
