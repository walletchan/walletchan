import {
  getHardwareSetupProvider,
  getHardwareSetupUrl,
  openHardwareSetupTab,
  openHardwareSetupTabWith,
  type HardwareSetupTabDependencies,
} from "./hardwareSetupRoute";

export function isTrezorSetupRoute(search: string): boolean {
  return getHardwareSetupProvider(search) === "trezor";
}

export function getTrezorSetupUrl(
  getRuntimeUrl: (path: string) => string,
): string {
  return getHardwareSetupUrl("trezor", getRuntimeUrl);
}

export async function openTrezorSetupTabWith(
  dependencies: HardwareSetupTabDependencies,
): Promise<void> {
  return openHardwareSetupTabWith("trezor", dependencies);
}

export async function openTrezorSetupTab(): Promise<void> {
  return openHardwareSetupTab("trezor");
}
