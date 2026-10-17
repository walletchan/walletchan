import { closeSidePanelForWindow } from "@/lib/sidePanelControls";
import {
  getCurrentExtensionViewKind,
  type ExtensionViewKind,
} from "@/app/extensionSurface";

export type HardwareSetupProvider = "ledger" | "trezor";

export interface HardwareSetupTabDependencies {
  getRuntimeUrl(path: string): string;
  createTab(options: { url: string; active: boolean }): Promise<{
    windowId?: number;
  }>;
  getViewKind(): ExtensionViewKind;
  closeSidePanel(windowId: number | undefined): Promise<boolean>;
  closeWindow(): void;
}

export function getHardwareSetupProvider(
  search: string,
): HardwareSetupProvider | null {
  const route = new URLSearchParams(search).get("route");
  if (route === "add-ledger") return "ledger";
  if (route === "add-trezor" && TREZOR_BUILD_ENABLED) return "trezor";
  return null;
}

export function getHardwareSetupUrl(
  provider: HardwareSetupProvider,
  getRuntimeUrl: (path: string) => string,
): string {
  const url = new URL(getRuntimeUrl("index.html"));
  url.searchParams.set("route", `add-${provider}`);
  return url.href;
}

export async function openHardwareSetupTabWith(
  provider: HardwareSetupProvider,
  dependencies: HardwareSetupTabDependencies,
): Promise<void> {
  const sourceView = dependencies.getViewKind();
  const tab = await dependencies.createTab({
    url: getHardwareSetupUrl(provider, dependencies.getRuntimeUrl),
    active: true,
  });
  if (sourceView !== "sidepanel") return;

  const closed = await dependencies.closeSidePanel(tab.windowId);
  if (!closed) dependencies.closeWindow();
}

export async function openHardwareSetupTab(
  provider: HardwareSetupProvider,
): Promise<void> {
  return openHardwareSetupTabWith(provider, {
    getRuntimeUrl: (path) => chrome.runtime.getURL(path),
    createTab: (options) => chrome.tabs.create(options),
    getViewKind: getCurrentExtensionViewKind,
    closeSidePanel: closeSidePanelForWindow,
    closeWindow: () => window.close(),
  });
}
import { TREZOR_BUILD_ENABLED } from "./buildFeatures";
