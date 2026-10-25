import type { LedgerAccount } from "../types";

/** ledgerDevices key. Ledger and Shell on one seed share a deviceId, so Shell entries get their own key. */
export function ledgerDeviceKey(account: Pick<LedgerAccount, "deviceId" | "vendor">): string {
  return account.vendor === "keycardShell" ? `keycardShell:${account.deviceId}` : account.deviceId;
}
