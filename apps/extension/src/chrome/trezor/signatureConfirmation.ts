/**
 * Trezor signature entrypoint. Pending-request claims and final release
 * authorization are shared with Ledger; the device signature adapter is not.
 */
export { handleConfirmTrezorSignatureRequest } from "../ledger/signatureConfirmation";
