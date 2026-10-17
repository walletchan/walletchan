import {
  LedgerError,
  LedgerErrorCode,
  normalizeLedgerError,
} from "../chrome/ledger/errors";
import * as ledgerSigner from "./ledgerSigner";
import * as shellSigner from "./shellSigner";
import type { HdPathScheme, LedgerSignerStatus } from "./ledgerSigner";

let activeOperationId: string | null = null;
// Cancel carries only opId, so remember which signer owns the active operation.
let activeSigner: { cancelActiveOperation(): void } = ledgerSigner;

export async function handleLedgerOffscreenMessage(
  message: Record<string, unknown>,
) {
  const opId = typeof message.opId === "string" ? message.opId : "";
  const dispatch = makeDispatch(opId);
  const signer = message.vendor === "keycardShell" ? shellSigner : ledgerSigner;
  if (message.type === "offscreen:ledgerCancel") {
    if (opId && activeOperationId === opId) activeSigner.cancelActiveOperation();
    return { ok: true, payload: true };
  }
  try {
    if (!opId) {
      throw new LedgerError(
        LedgerErrorCode.UNKNOWN,
        "Missing Ledger operation ID.",
      );
    }
    if (activeOperationId) {
      throw new LedgerError(
        LedgerErrorCode.TRANSPORT_BUSY,
        "Another Ledger operation is in progress.",
      );
    }
    activeOperationId = opId;
    activeSigner = signer;
    let payload: unknown;
    switch (message.type) {
      case "offscreen:ledgerConnect":
        payload = message.vendor === "keycardShell"
          ? await shellSigner.connectShell(dispatch)
          : await ledgerSigner.connectLedger(
            message.productName as string | undefined,
            dispatch,
          );
        break;
      case "offscreen:ledgerScan":
        payload = await signer.scanAddresses(
          message.deviceId as string,
          message.startIndex as number,
          message.count as number,
          message.scheme as HdPathScheme,
          message.customTemplate as string | undefined,
          dispatch,
        );
        break;
      case "offscreen:ledgerSignTx":
        payload = await signer.signTransaction(
          message.deviceId as string,
          message.hdPath as string,
          message.unsignedTx as `0x${string}`,
          dispatch,
        );
        break;
      case "offscreen:ledgerSignMessage":
        payload = await signer.signMessage(
          message.deviceId as string,
          message.hdPath as string,
          message.hex as `0x${string}`,
          dispatch,
        );
        break;
      case "offscreen:ledgerSignTypedData":
        payload = await signer.signTypedData(
          message.deviceId as string,
          message.hdPath as string,
          message.typedData as Parameters<typeof ledgerSigner.signTypedData>[2],
          dispatch,
        );
        break;
      default:
        throw new LedgerError(
          LedgerErrorCode.UNKNOWN,
          "Unknown Ledger operation.",
        );
    }
    return { ok: true, payload };
  } catch (error) {
    dispatch("error", { errorCode: normalizeLedgerError(error).code });
    return { ok: false, error: serializeLedgerError(error) };
  } finally {
    if (activeOperationId === opId) activeOperationId = null;
  }
}

export function serializeLedgerError(error: unknown) {
  const normalized = normalizeLedgerError(error);
  return {
    code: normalized.code,
    userMessage: normalized.userMessage,
    technicalMessage: normalized.technicalMessage,
  };
}

function makeDispatch(opId?: string) {
  return (status: LedgerSignerStatus, extra?: Record<string, unknown>) => {
    if (!opId) return;
    chrome.runtime
      .sendMessage({
        type: "offscreenLedgerStatus",
        source: "walletchan-ledger-offscreen",
        opId,
        status,
        ...extra,
      })
      .catch(() => undefined);
  };
}
