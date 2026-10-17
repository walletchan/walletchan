import type { HardwareWalletDerivationOption } from "@/components/HardwareWallet/types";

export type LedgerDerivationScheme = "ledgerLive" | "bip44" | "legacyMew";

export const LEDGER_DERIVATION_OPTIONS: ReadonlyArray<
  HardwareWalletDerivationOption<LedgerDerivationScheme>
> = [
  { value: "ledgerLive", label: "Ledger Wallet", path: "m/44'/60'/n'/0/0" },
  { value: "bip44", label: "BIP-44", path: "m/44'/60'/0'/0/n" },
  { value: "legacyMew", label: "Legacy MEW", path: "m/44'/60'/0'/n" },
];
