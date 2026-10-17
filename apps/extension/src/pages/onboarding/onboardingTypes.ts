export type OnboardingStep =
  | "welcome"
  | "accountType"
  | "bankrSetup"
  | "privateKey"
  | "seedPhrase"
  | "viewOnly"
  | "safe"
  | "ledger"
  | "trezor"
  | "password"
  | "success";

export type AccountTypeChoice =
  | "seedPhrase"
  | "privateKey"
  | "viewOnly"
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
  viewOnly: "viewOnly", ledger: "ledger", trezor: "trezor", safe: "safe",
} as const satisfies Record<AccountTypeChoice, OnboardingStep>;
