import type { BunkerAccountView } from "@/chrome/safeBunker/types";

/** Drive bounded background scan pages while this restore screen remains authorized. */
export async function completeBunkerRestore(initial: BunkerAccountView, controls: {
  isCurrent: () => boolean;
  authorize: () => Promise<boolean>;
  continueRecovery: (id: string) => Promise<BunkerAccountView>;
  onProgress: (view: BunkerAccountView) => void;
}): Promise<BunkerAccountView | null> {
  let view = initial;
  while (controls.isCurrent()) {
    controls.onProgress(view);
    if (!view.recovering) {
      if (!view.deployed) throw new Error("Bunker restore did not complete. Reopen setup and retry.");
      return view;
    }
    if (!await controls.authorize() || !controls.isCurrent()) return null;
    view = await controls.continueRecovery(view.draftId);
  }
  return null;
}
