export type ScreenTransitionKind = "slide" | "fade";

export interface ScreenTransitionMeta {
  kind: ScreenTransitionKind;
  depth: number;
}
export interface ScreenTransitionPlan {
  direction: "forward" | "back";
  kind: ScreenTransitionKind;
}

/**
 * Keeps the navigation decision independent from the animation runtime so it
 * can be regression-tested without mounting React or Framer Motion.
 */
export function getScreenTransitionPlan(
  previous: ScreenTransitionMeta,
  next: ScreenTransitionMeta,
): ScreenTransitionPlan {
  const useFade = previous.kind === "fade" || next.kind === "fade";

  return {
    direction: next.depth > previous.depth || useFade ? "forward" : "back",
    kind: useFade ? "fade" : "slide",
  };
}

export type AppView =
  | "seedGroupBackup"
  | "main"
  | "unlock"
  | "settings"
  | "settingsAddChain"
  | "accountSettings"
  | "pendingTxList"
  | "txConfirm"
  | "signatureConfirm"
  | "erc7715PermissionConfirm"
  | "watchAssetConfirm"
  | "addChainConfirm"
  | "dappConnectionConfirm"
  | "waitingForOnboarding"
  | "chat"
  | "addAccount"
  | "safeApprovals"
  | "safeBunker"
  | "transfer"
  | "swap"
  | "staking"
  | "shield"
  | "more"
  | "hideTokens"
  | "hiddenTokens"
  | "walletConnect"
  | "batchTxConfirm"
  | "crossDappBatchConfirm"
  | "txDetail";
export const SCREEN_META: Record<AppView, ScreenTransitionMeta> = {
  main: { kind: "slide", depth: 0 },
  settings: { kind: "slide", depth: 1 },
  settingsAddChain: { kind: "slide", depth: 2 },
  accountSettings: { kind: "slide", depth: 1 },
  swap: { kind: "slide", depth: 1 },
  staking: { kind: "slide", depth: 2 },
  shield: { kind: "slide", depth: 1 },
  transfer: { kind: "slide", depth: 1 },
  more: { kind: "slide", depth: 1 },
  hideTokens: { kind: "slide", depth: 2 },
  hiddenTokens: { kind: "slide", depth: 3 },
  walletConnect: { kind: "slide", depth: 1 },
  chat: { kind: "slide", depth: 1 },
  addAccount: { kind: "slide", depth: 1 },
  safeBunker: { kind: "slide", depth: 1 },
  seedGroupBackup: { kind: "slide", depth: 1 },
  safeApprovals: { kind: "slide", depth: 1 },
  pendingTxList: { kind: "slide", depth: 1 },
  txDetail: { kind: "slide", depth: 2 },
  txConfirm: { kind: "slide", depth: 1 },
  batchTxConfirm: { kind: "slide", depth: 1 },
  crossDappBatchConfirm: { kind: "slide", depth: 1 },
  signatureConfirm: { kind: "slide", depth: 1 },
  erc7715PermissionConfirm: { kind: "slide", depth: 1 },
  watchAssetConfirm: { kind: "slide", depth: 1 },
  addChainConfirm: { kind: "slide", depth: 1 },
  dappConnectionConfirm: { kind: "slide", depth: 1 },
  unlock: { kind: "fade", depth: 0 },
  waitingForOnboarding: { kind: "fade", depth: 0 },
};
