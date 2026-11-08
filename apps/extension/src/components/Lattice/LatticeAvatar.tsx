import { HardwareWalletAvatar } from "@/components/HardwareWallet/HardwareWalletAvatar";
import { LATTICE_HARDWARE_WALLET_BRAND } from "./latticeBrand";

/** Lattice mark used where an address blockie would be misleading. */
export function LatticeAvatar({ size = 20 }: { size?: number }) {
  return (
    <HardwareWalletAvatar
      brand={LATTICE_HARDWARE_WALLET_BRAND}
      size={size}
    />
  );
}
