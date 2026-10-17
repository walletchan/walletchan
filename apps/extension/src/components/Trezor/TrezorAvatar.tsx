import { HardwareWalletAvatar } from "@/components/HardwareWallet/HardwareWalletAvatar";
import { TREZOR_HARDWARE_WALLET_BRAND } from "./trezorBrand";

export function TrezorAvatar({ size = 40 }: { size?: number }) {
  return (
    <HardwareWalletAvatar
      brand={TREZOR_HARDWARE_WALLET_BRAND}
      size={size}
    />
  );
}
