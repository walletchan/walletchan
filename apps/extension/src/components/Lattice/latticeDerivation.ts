import type { HardwareWalletDerivationOption } from "@/components/HardwareWallet/types";

export type LatticeDerivationScheme = "bip44" | "ledgerLive" | "legacyMew";

export const LATTICE_DERIVATION_OPTIONS: ReadonlyArray<
  HardwareWalletDerivationOption<LatticeDerivationScheme>
> = [
  { value: "bip44", label: "Standard (BIP-44)", path: "m/44'/60'/0'/0/n" },
  { value: "ledgerLive", label: "Ledger Live", path: "m/44'/60'/n'/0/0" },
  { value: "legacyMew", label: "Legacy MEW", path: "m/44'/60'/0'/n" },
];
