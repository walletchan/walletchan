/** Explicit trusted-wallet-UI audience for Activity history and receipt reads. */
export const ACTIVITY_WALLET_UI_MESSAGE_TYPES = [
  "getTxHistory",
  "getSignatureHistory",
  "getActivityHistorySummary",
  "clearSignatureHistory",
  "exportActivity",
  "getTxHistoryPage",
  "getSendRecipientReferences",
  "getTxHistoryItem",
  "getTransactionCalldata",
  "resolveHistoryNftMetadata",
  "getProcessingTxs",
  "getFailedTxResult",
  "checkPendingTxReceipt",
] as const;
