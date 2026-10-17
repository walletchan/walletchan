import {
  getHardwareSetupProvider,
  getHardwareSetupUrl,
  openHardwareSetupTab,
  openHardwareSetupTabWith,
  type HardwareSetupTabDependencies,
} from "./hardwareSetupRoute";

export function isLedgerSetupRoute(search: string): boolean {
  return getHardwareSetupProvider(search) === "ledger";
}

export function getLedgerSetupUrl(
  getRuntimeUrl: (path: string) => string,
): string {
  return getHardwareSetupUrl("ledger", getRuntimeUrl);
}

export async function openLedgerSetupTabWith(
  dependencies: HardwareSetupTabDependencies,
): Promise<void> {
  return openHardwareSetupTabWith("ledger", dependencies);
}

export async function openLedgerSetupTab(): Promise<void> {
  return openHardwareSetupTab("ledger");
}
