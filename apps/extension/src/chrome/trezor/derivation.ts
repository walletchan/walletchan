import { isValidBip32Path } from "../../lib/bip32Path";

export const TREZOR_DEVICE_IDENTITY_PATH = "m/44'/60'/0'/0/0";
export const MAX_TREZOR_DISCOVERY_COUNT = 20;
export const MAX_TREZOR_DERIVATION_INDEX = 0x7fffffff;

export type TrezorDerivationScheme = "standard" | "account" | "legacy";

export interface TrezorDerivationRow {
  hdPath: string;
  hdIndex: number;
}

export function buildTrezorDerivationPage(input: {
  scheme: TrezorDerivationScheme;
  startIndex: number;
  count: number;
}): TrezorDerivationRow[] {
  const { scheme, startIndex, count } = input;
  if (
    !Number.isSafeInteger(startIndex) ||
    startIndex < 0 ||
    startIndex > MAX_TREZOR_DERIVATION_INDEX
  ) {
    throw new Error("Invalid Trezor derivation start index.");
  }
  if (
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > MAX_TREZOR_DISCOVERY_COUNT ||
    startIndex + count - 1 > MAX_TREZOR_DERIVATION_INDEX
  ) {
    throw new Error("Invalid Trezor address count.");
  }

  return Array.from({ length: count }, (_, offset) => {
    const hdIndex = startIndex + offset;
    const hdPath = pathForScheme(scheme, hdIndex);
    if (!isValidBip32Path(hdPath)) {
      throw new Error("Invalid generated Trezor derivation path.");
    }
    return { hdPath, hdIndex };
  });
}

export function isReleasedTrezorPath(path: string, hdIndex: number): boolean {
  if (
    !Number.isSafeInteger(hdIndex) ||
    hdIndex < 0 ||
    hdIndex > MAX_TREZOR_DERIVATION_INDEX
  ) {
    return false;
  }
  return (
    path === pathForScheme("standard", hdIndex) ||
    path === pathForScheme("account", hdIndex) ||
    path === pathForScheme("legacy", hdIndex)
  );
}

function pathForScheme(
  scheme: TrezorDerivationScheme,
  index: number,
): string {
  switch (scheme) {
    case "standard":
      return `m/44'/60'/0'/0/${index}`;
    case "account":
      return `m/44'/60'/${index}'/0/0`;
    case "legacy":
      return `m/44'/60'/0'/${index}`;
    default:
      throw new Error("Invalid Trezor derivation scheme.");
  }
}
