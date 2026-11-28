import type { AccountType } from "../types";

export type AccountSigningTransport =
  | "bankr"
  | "local"
  | "ledger"
  | "trezor"
  | "none";

export interface AccountTypeCapabilities {
  signingTransport: AccountSigningTransport;
  customEvmChains: boolean;
  personalSign: boolean;
  typedDataSign: boolean;
  rawEthSign: boolean;
  erc5792Batch: boolean;
  crossDappBatch: boolean;
  eip7702: boolean;
  erc7715: boolean;
  feeTokenExecution: boolean;
  sponsoredTransfer: boolean;
  forceInclusion: boolean;
  directSwap: boolean;
  safeOwner: boolean;
  safeNativeExecution: boolean;
  privacyPoolsSingleTransaction: boolean;
  privacyPoolsMultiExit: boolean;
  approvalCleanupMutation: boolean;
  transactionReplacement: boolean;
  customNonce: boolean;
  agentPasswordSigning: boolean;
}

/**
 * Exhaustive account capability registry.
 *
 * This is the per-feature support boundary for every account type. General
 * direct-signer classification belongs to accounts/accountTypePolicy.ts. Feature domains
 * may impose narrower release policy, but must not grant a capability that is
 * false here. Adding another AccountType fails compilation until every
 * authority-bearing behavior is chosen explicitly.
 */
export const ACCOUNT_TYPE_CAPABILITIES = {
  bankr: {
    signingTransport: "bankr",
    customEvmChains: false,
    personalSign: true,
    typedDataSign: true,
    rawEthSign: true,
    erc5792Batch: true,
    crossDappBatch: true,
    eip7702: true,
    erc7715: false,
    feeTokenExecution: true,
    sponsoredTransfer: true,
    forceInclusion: true,
    directSwap: true,
    safeOwner: true,
    safeNativeExecution: false,
    privacyPoolsSingleTransaction: true,
    privacyPoolsMultiExit: true,
    approvalCleanupMutation: true,
    transactionReplacement: false,
    customNonce: false,
    agentPasswordSigning: true,
  },
  privateKey: {
    signingTransport: "local",
    customEvmChains: true,
    personalSign: true,
    typedDataSign: true,
    rawEthSign: true,
    erc5792Batch: true,
    crossDappBatch: true,
    eip7702: true,
    erc7715: true,
    feeTokenExecution: true,
    sponsoredTransfer: true,
    forceInclusion: true,
    directSwap: true,
    safeOwner: true,
    safeNativeExecution: true,
    privacyPoolsSingleTransaction: true,
    privacyPoolsMultiExit: true,
    approvalCleanupMutation: true,
    transactionReplacement: true,
    customNonce: true,
    agentPasswordSigning: true,
  },
  seedPhrase: {
    signingTransport: "local",
    customEvmChains: true,
    personalSign: true,
    typedDataSign: true,
    rawEthSign: true,
    erc5792Batch: true,
    crossDappBatch: true,
    eip7702: true,
    erc7715: true,
    feeTokenExecution: true,
    sponsoredTransfer: true,
    forceInclusion: true,
    directSwap: true,
    safeOwner: true,
    safeNativeExecution: true,
    privacyPoolsSingleTransaction: true,
    privacyPoolsMultiExit: true,
    approvalCleanupMutation: true,
    transactionReplacement: true,
    customNonce: true,
    agentPasswordSigning: true,
  },
  ledger: {
    signingTransport: "ledger",
    customEvmChains: true,
    personalSign: true,
    typedDataSign: true,
    rawEthSign: false,
    erc5792Batch: false,
    crossDappBatch: false,
    eip7702: false,
    erc7715: false,
    feeTokenExecution: false,
    sponsoredTransfer: false,
    forceInclusion: true,
    directSwap: false,
    safeOwner: true,
    safeNativeExecution: true,
    privacyPoolsSingleTransaction: true,
    privacyPoolsMultiExit: false,
    approvalCleanupMutation: false,
    transactionReplacement: true,
    customNonce: true,
    agentPasswordSigning: true,
  },
  trezor: {
    signingTransport: "trezor",
    customEvmChains: true,
    personalSign: true,
    typedDataSign: true,
    rawEthSign: false,
    erc5792Batch: false,
    crossDappBatch: false,
    eip7702: false,
    erc7715: false,
    feeTokenExecution: false,
    sponsoredTransfer: false,
    forceInclusion: false,
    directSwap: false,
    safeOwner: true,
    safeNativeExecution: true,
    privacyPoolsSingleTransaction: true,
    privacyPoolsMultiExit: false,
    approvalCleanupMutation: false,
    transactionReplacement: true,
    customNonce: true,
    agentPasswordSigning: true,
  },
  impersonator: {
    signingTransport: "none",
    customEvmChains: true,
    personalSign: false,
    typedDataSign: false,
    rawEthSign: false,
    erc5792Batch: false,
    crossDappBatch: false,
    eip7702: false,
    erc7715: false,
    feeTokenExecution: false,
    sponsoredTransfer: false,
    forceInclusion: false,
    directSwap: false,
    safeOwner: false,
    safeNativeExecution: false,
    privacyPoolsSingleTransaction: false,
    privacyPoolsMultiExit: false,
    approvalCleanupMutation: false,
    transactionReplacement: false,
    customNonce: false,
    agentPasswordSigning: false,
  },
  safe: {
    signingTransport: "none",
    customEvmChains: false,
    personalSign: false,
    typedDataSign: false,
    rawEthSign: false,
    erc5792Batch: true,
    crossDappBatch: false,
    eip7702: false,
    erc7715: false,
    feeTokenExecution: false,
    sponsoredTransfer: false,
    forceInclusion: false,
    directSwap: true,
    safeOwner: false,
    safeNativeExecution: false,
    privacyPoolsSingleTransaction: false,
    privacyPoolsMultiExit: false,
    approvalCleanupMutation: false,
    transactionReplacement: false,
    customNonce: false,
    agentPasswordSigning: false,
  },
  safeBunker: {
    signingTransport: "none",
    customEvmChains: false,
    personalSign: false,
    typedDataSign: false,
    rawEthSign: false,
    erc5792Batch: true,
    crossDappBatch: true,
    eip7702: false,
    erc7715: false,
    feeTokenExecution: false,
    sponsoredTransfer: false,
    forceInclusion: false,
    directSwap: true,
    safeOwner: false,
    safeNativeExecution: false,
    privacyPoolsSingleTransaction: false,
    privacyPoolsMultiExit: false,
    approvalCleanupMutation: false,
    transactionReplacement: false,
    customNonce: false,
    agentPasswordSigning: false,
  },
} as const satisfies Record<AccountType, AccountTypeCapabilities>;

export function getAccountTypeCapabilities(
  accountType: AccountType,
): AccountTypeCapabilities {
  return ACCOUNT_TYPE_CAPABILITIES[accountType];
}

export function isKnownAccountType(value: unknown): value is AccountType {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(ACCOUNT_TYPE_CAPABILITIES, value)
  );
}

export function hasAccountTypeCapability(
  accountType: unknown,
  capability: keyof AccountTypeCapabilities,
): boolean {
  return (
    isKnownAccountType(accountType) &&
    Boolean(ACCOUNT_TYPE_CAPABILITIES[accountType][capability])
  );
}

export function isHardwareAccountType(
  accountType: AccountType,
): accountType is "ledger" | "trezor" {
  const transport = ACCOUNT_TYPE_CAPABILITIES[accountType].signingTransport;
  return transport === "ledger" || transport === "trezor";
}
