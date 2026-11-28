import type { SafeBunkerAccount } from "@/chrome/types";
import type { BunkerAccountView } from "@/chrome/safeBunker/types";
import { bunkerCommand } from "@/components/SafeBunker/transport";

type ScreenModule = typeof import("@/components/SafeBunker/BunkerAccountScreen");
let screenModule: ScreenModule | undefined;
let screenLoad: Promise<ScreenModule> | undefined;

/** Cache code only. Request/default-payer snapshots are freshly read for each open. */
export function loadBunkerRequestScreen(): Promise<ScreenModule> {
  return screenLoad ??= import("@/components/SafeBunker/BunkerAccountScreen").then(module => {
    screenModule = module; return module;
  }).catch(error => { screenLoad = undefined; throw error; });
}
export function loadedBunkerRequestScreen() { return screenModule?.BunkerAccountScreen; }

export async function preloadBunkerRequest(account: SafeBunkerAccount): Promise<BunkerAccountView> {
  const [, response] = await Promise.all([
    loadBunkerRequestScreen(),
    bunkerCommand<{ view: BunkerAccountView }>({ type: "getSafeBunkerView", id: account.bunkerId }),
  ]);
  const view = response.view;
  if (view.id !== account.id || view.draftId !== account.bunkerId || view.chainId !== account.chainId ||
      view.seedGroupId !== account.seedGroupId || view.safeAddress.toLowerCase() !== account.address.toLowerCase())
    throw new Error("Bunker account changed. Reopen the request.");
  return view;
}
