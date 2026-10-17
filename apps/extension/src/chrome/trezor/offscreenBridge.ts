/** Compatibility facade: Trezor Connect 10 now runs in the background worker. */
export {
  connectTrezor,
  scanTrezorAddresses,
  signTrezorTransaction,
  signTrezorMessage,
  signTrezorTypedData,
  cancelTrezorOperation,
} from "./connectClient";
