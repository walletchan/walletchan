import type { Account } from "@/chrome/types";

export function getSeedAccountLabel(
  account: Account,
  seedGroupMap: Map<string, string>,
) {
  if (account.type !== "seedPhrase") return null;
  const groupName = seedGroupMap.get(account.seedGroupId) || "Seed phrase";
  return `${groupName} · Account ${account.derivationIndex + 1}`;
}

export function getWalletTypeLabel(
  account: Account,
  seedGroupMap: Map<string, string>,
) {
  if (account.type === "bankr") return "Bankr API";
  if (account.type === "privateKey") return "Private key";
  if (account.type === "seedPhrase") {
    return getSeedAccountLabel(account, seedGroupMap) || "Seed phrase";
  }
  if (account.type === "ledger") return `${hardwareName(account)} · Account ${account.hdIndex + 1}`;
  if (account.type === "trezor") return `Trezor · Account ${account.hdIndex + 1}`;
  if (account.type === "safe") return "Safe multisig";
  return "View only";
}

export function getAccountSettingsTypeLabel(account: Account): string {
  switch (account.type) {
    case "bankr":
      return "Bankr";
    case "privateKey":
      return "Private Key";
    case "seedPhrase":
      return `Seed · #${account.derivationIndex}`;
    case "ledger":
      return hardwareName(account);
    case "trezor":
      return "Trezor";
    case "impersonator":
      return "View-Only";
    case "safe":
      return "Safe";
  }
}

export function hardwareName(account: Extract<Account, { type: "ledger" }>): string {
  return account.vendor === "keycardShell" ? "Keycard Shell" : "Ledger";
}

/** Hardware vendor of a stored account, for UI that only receives an account ID. */
export function getHardwareVendor(accounts: readonly Account[], accountId: string | undefined) {
  const account = accounts.find((candidate) => candidate.id === accountId);
  return account?.type === "ledger" ? account.vendor : undefined;
}
