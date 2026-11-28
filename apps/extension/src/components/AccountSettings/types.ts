import type { Account } from "@/chrome/types";

export interface AccountSettingsProps {
  account: Account | null;
  onClose: () => void;
  onAccountUpdated: () => void | Promise<unknown>;
  onBunkerSubmitted?: (account: Account) => void;
  accounts: Account[];
  initialView?: AccountSettingsSubView;
  onSessionExpired?: (returnView?: AccountSettingsSubView) => void;
  apiKeyDraft?: BankrConfigDraft | null;
  onApiKeyDraftChange?: (draft: BankrConfigDraft | null) => void;
}
export type AccountSettingsSubView =
  | "rotateBunkerOwner"
  | "settings"
  | "changeApiKey"
  | "revealPrivateKey"
  | "revealSeedPhrase"
  | "smartAccount"
  | "delegatedPermissions";
export interface BankrConfigDraft {
  accountId: string;
  apiKey: string;
  walletAddress: string;
}
