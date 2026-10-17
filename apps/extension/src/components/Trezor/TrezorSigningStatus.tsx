import { HardwareWalletSigningStatus } from "@/components/HardwareWallet/HardwareWalletSigningStatus";
import { TREZOR_HARDWARE_WALLET_BRAND } from "./trezorBrand";

export function TrezorSigningStatus({ active }: { active: boolean }) {
  return (
    <HardwareWalletSigningStatus
      active={active}
      brand={TREZOR_HARDWARE_WALLET_BRAND}
      message="Sign the request with your Trezor"
    />
  );
}
