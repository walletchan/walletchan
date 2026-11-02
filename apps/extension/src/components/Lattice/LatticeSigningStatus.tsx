import { HardwareWalletSigningStatus } from "@/components/HardwareWallet/HardwareWalletSigningStatus";
import { LATTICE_HARDWARE_WALLET_BRAND } from "./latticeBrand";

/** Keeps the hardware action visible without replacing the request review. */
export function LatticeSigningStatus({ active }: { active: boolean }) {
  return (
    <HardwareWalletSigningStatus
      active={active}
      brand={LATTICE_HARDWARE_WALLET_BRAND}
      message="Approve the request on your Lattice"
    />
  );
}
