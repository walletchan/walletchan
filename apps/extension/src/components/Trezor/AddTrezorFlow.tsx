import type { ReactNode } from "react";
import AddHardwareWalletFlow, {
  type HardwareWalletFlowLayoutParts,
} from "@/components/HardwareWallet/AddHardwareWalletFlow";
import type {
  HardwareWalletAccountSelection,
  HardwareWalletAddressSelection,
} from "@/components/HardwareWallet/types";
import { trezorHardwareWalletProvider } from "./trezorFlowAdapter";

export type TrezorAddressSelection = HardwareWalletAddressSelection;
export type TrezorAccountSelection = HardwareWalletAccountSelection;
export type TrezorFlowLayoutParts = HardwareWalletFlowLayoutParts;

export interface AddTrezorFlowProps {
  onBack(): void;
  onComplete(): void;
  commitAccounts?(selection: TrezorAccountSelection): Promise<void>;
  renderLayout?(parts: TrezorFlowLayoutParts): ReactNode;
}

export default function AddTrezorFlow(props: AddTrezorFlowProps) {
  return (
    <AddHardwareWalletFlow
      provider={trezorHardwareWalletProvider}
      {...props}
    />
  );
}
