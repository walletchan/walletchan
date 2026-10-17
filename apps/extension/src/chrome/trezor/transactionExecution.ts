/**
 * Trezor transaction entrypoint. The durable pending-request, privacy,
 * history, receipt, and broadcast lifecycle is shared with Ledger; payload
 * construction and signature verification remain Trezor-specific.
 */
export { handleConfirmTransactionAsyncTrezor } from "../ledger/transactionExecution";
