import type { HardwareWalletDerivationOption } from "@/components/HardwareWallet/types";
import type { TrezorDerivationScheme } from "@/chrome/trezor/derivation";

export const TREZOR_DERIVATION_OPTIONS: ReadonlyArray<
  HardwareWalletDerivationOption<TrezorDerivationScheme>
> = [
  {
    value: "standard",
    label: "Standard",
    path: "m/44'/60'/0'/0/{index}",
  },
  {
    value: "account",
    label: "Account-based",
    path: "m/44'/60'/{index}'/0/0",
  },
  {
    value: "legacy",
    label: "Legacy",
    path: "m/44'/60'/0'/{index}",
  },
];
