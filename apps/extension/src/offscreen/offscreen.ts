import { LedgerError, LedgerErrorCode } from "../chrome/ledger/errors";
import {
  handleLedgerOffscreenMessage,
  serializeLedgerError,
} from "./ledgerMessageHandler";
import { isTrustedHardwareBackgroundSender } from "./messageAuthorization";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== "walletchan-ledger-offscreen") return false;
  if (!isTrustedHardwareBackgroundSender(sender)) {
    sendResponse({
      ok: false,
      error: serializeLedgerError(
        new LedgerError(
          LedgerErrorCode.UNKNOWN,
          "Unauthorized Ledger bridge request.",
        ),
      ),
    });
    return false;
  }
  handleLedgerOffscreenMessage(message)
    .then(sendResponse)
    .catch((error) => {
      sendResponse({ ok: false, error: serializeLedgerError(error) });
    });
  return true;
});
