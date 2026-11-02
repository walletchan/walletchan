/** Derivation schemes offered for Lattice accounts; the firmware accepts 2 to 5 levels. */
import { isValidBip32Path } from "../../lib/bip32Path";

export type LatticeDerivationScheme = "bip44" | "ledgerLive" | "legacyMew";

export const LATTICE_DERIVATION_TEMPLATES: Readonly<Record<LatticeDerivationScheme, string>> = {
  bip44: "m/44'/60'/0'/0/{index}",
  ledgerLive: "m/44'/60'/{index}'/0/0",
  legacyMew: "m/44'/60'/0'/{index}",
};

/** Device and wallet identity path, as for Ledger. */
export const LATTICE_CANONICAL_PATH = "m/44'/60'/0'/0/0";

const MAX_INDEX = 0x7fffffff;

export function isLatticeDerivationScheme(value: unknown): value is LatticeDerivationScheme {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(LATTICE_DERIVATION_TEMPLATES, value);
}

export function latticeDerivationPath(scheme: LatticeDerivationScheme, index: number): string {
  if (!Number.isSafeInteger(index) || index < 0 || index > MAX_INDEX) {
    throw new Error("Lattice derivation index is out of range.");
  }
  const path = LATTICE_DERIVATION_TEMPLATES[scheme].replace("{index}", String(index));
  if (!isValidBip32Path(path)) throw new Error("Invalid Lattice derivation path.");
  return path;
}
