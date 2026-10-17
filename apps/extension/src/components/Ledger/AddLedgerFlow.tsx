import type { ReactNode } from "react";
import AddHardwareWalletFlow, {
  type HardwareWalletFlowLayoutParts,
} from "@/components/HardwareWallet/AddHardwareWalletFlow";
import type {
  HardwareWalletAccountSelection,
  HardwareWalletAddressSelection,
} from "@/components/HardwareWallet/types";
import { ledgerHardwareWalletProvider } from "./ledgerFlowAdapter";

export type LedgerAddressSelection = HardwareWalletAddressSelection;
export type LedgerAccountSelection = HardwareWalletAccountSelection;
export type LedgerFlowLayoutParts = HardwareWalletFlowLayoutParts;

export interface AddLedgerFlowProps {
  onBack(): void;
  onComplete(): void;
  commitAccounts?(selection: LedgerAccountSelection): Promise<void>;
  renderLayout?(parts: LedgerFlowLayoutParts): ReactNode;
}

export default function AddLedgerFlow(props: AddLedgerFlowProps) {
  return (
    <AddHardwareWalletFlow
      provider={ledgerHardwareWalletProvider}
      {...props}
    />
  );
}
