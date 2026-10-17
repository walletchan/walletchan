import type { AccountType } from "@/components/AddAccountTypeGrid";

export const accountTypeTitles: Record<AccountType, string> = {
  privateKey: "Private key",
  seedPhrase: "Seed phrase",
  ledger: "Ledger",
  bankr: "Bankr API",
  impersonator: "View-only account",
  safe: "Safe",
  safeBunker: "Safe Bunker",
};
