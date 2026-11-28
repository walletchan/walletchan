export type OnboardingStep =
  | "welcome"
  | "accountType"
  | "bankrSetup"
  | "privateKey"
  | "seedPhrase"
  | "viewOnly"
  | "safeBunker"
  | "safe"
  | "ledger"
  | "trezor"
  | "bunkerDiscovery"
  | "password"
  | "success";

export type AccountTypeChoice =
  | "seedPhrase"
  | "privateKey"
  | "viewOnly"
  | "safeBunker"
  | "safe"
  | "ledger"
  | "trezor"
  | "bankr";

export type OnboardingErrors = {
  apiKey?: string;
  privateKey?: string;
  walletAddress?: string;
  viewOnlyAddress?: string;
  password?: string;
  confirmPassword?: string;
};

export const ACCOUNT_SETUP_STEPS = {
  bankr: "bankrSetup", privateKey: "privateKey", seedPhrase: "seedPhrase",
  viewOnly: "viewOnly", ledger: "ledger", trezor: "trezor", safe: "safe", safeBunker: "safeBunker",
} as const satisfies Record<AccountTypeChoice, OnboardingStep>;

export const BUNKER_ONBOARDING_STEPS = [
  { title: "Choose account" }, { title: "Add details" }, { title: "Secure wallet" }, { title: "Import Bunkers" },
];
