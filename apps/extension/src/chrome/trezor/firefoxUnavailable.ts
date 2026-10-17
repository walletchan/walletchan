/**
 * Firefox build boundary for the Chromium-only Trezor release.
 *
 * Vite aliases authority-bearing Trezor modules to this file only for the
 * Firefox background target. Public account codecs remain readable so an
 * imported profile cannot corrupt account state, but setup and signing have no
 * executable transport in the artifact.
 */

const unavailable = (): never => {
  throw new Error("Trezor is not available in Firefox.");
};

export const handleTrezorConnect = unavailable;
export const handleTrezorScan = unavailable;
export const handleTrezorCancel = unavailable;
export const handleAddTrezorAccounts = unavailable;
export const handleGetTrezorDevices = unavailable;
export const ensureTrezorSigningSession = unavailable;
export const signAndBroadcastTrezorTransaction = unavailable;
export const signTrezorSignatureRequest = unavailable;
export const signTrezorTypedDataForAccount = unavailable;

export const cancelTrezorOperation = async (): Promise<boolean> => false;
export const createTrezorOperationId = (): string => crypto.randomUUID();

export const BACKGROUND_TREZOR_MESSAGE_TYPES = [] as const;

export function createBackgroundTrezorMessageRouter() {
  return () => ({ handled: false as const });
}
