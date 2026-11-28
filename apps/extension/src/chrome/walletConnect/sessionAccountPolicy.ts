import { getAccounts } from "../accountStorage";
import type { Account } from "../types";
import { getAccountTypeCapabilities } from "../hardware/accountCapabilities";
import {
  WALLETCONNECT_SUPPORTED_METHODS,
  getSessionAccounts,
  isAddress,
  isSigningAccount,
  type SigningAccount,
} from "./sessionPolicy";

export type SessionAccount = SigningAccount | Extract<Account, { type: "safe" | "safeBunker" }>;

const ERC5792_SESSION_METHODS = new Set([
  "wallet_getCapabilities",
  "wallet_sendCalls",
  "wallet_getCallsStatus",
  "wallet_showCallsStatus",
]);

const ERC7715_SESSION_METHODS = new Set([
  "wallet_getSupportedExecutionPermissions",
  "wallet_requestExecutionPermissions",
  "wallet_getGrantedExecutionPermissions",
]);

export function getWalletConnectMethodsForAccount(account: SessionAccount): string[] {
  const capabilities = getAccountTypeCapabilities(account.type);
  return WALLETCONNECT_SUPPORTED_METHODS.filter((method) => {
    if (ERC5792_SESSION_METHODS.has(method)) {
      return capabilities.erc5792Batch;
    }
    if (ERC7715_SESSION_METHODS.has(method)) {
      return capabilities.erc7715;
    }
    if (method === "personal_sign") return capabilities.personalSign;
    if (
      method === "eth_signTypedData_v3" ||
      method === "eth_signTypedData_v4"
    ) {
      return capabilities.typedDataSign;
    }
    return true;
  });
}

export function isSessionAccount(account: Account | null): account is SessionAccount {
  return isSigningAccount(account) || account?.type === "safe" || account?.type === "safeBunker";
}

export async function resolveSessionAccount(
  session: any,
  chainId: number,
  requestedAddress: string | null,
): Promise<SessionAccount> {
  const authorized = getSessionAccounts(session, chainId);
  const requested = requestedAddress || authorized[0];
  if (!isAddress(requested) || !authorized.some((entry) => entry.toLowerCase() === requested.toLowerCase())) {
    throw new Error("Requested account is not authorized for this session");
  }
  const matching = (await getAccounts()).filter(
    (entry) => entry.address.toLowerCase() === requested.toLowerCase() && isSessionAccount(entry),
  );
  if (matching.length !== 1) {
    throw new Error(matching.length > 1
      ? "Session account identity is ambiguous"
      : "No supported account found for this session");
  }
  if (matching[0].type === "safeBunker" && matching[0].chainId !== chainId) throw new Error("Bunker is not deployed on this chain");
  return matching[0] as SessionAccount;
}
