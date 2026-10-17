import { LedgerError, LedgerErrorCode, normalizeLedgerError } from "./errors";
import {
  ensureHardwareOffscreen,
  withHardwareOffscreenRequest,
} from "../hardware/offscreenManager";

const TARGET = "walletchan-ledger-offscreen";

export type LedgerStatusUpdate = {
  opId: string;
  status: "connecting" | "awaiting-app" | "scanning" | "awaiting-confirmation" | "signing" | "success" | "error";
  errorCode?: string;
  interaction?: string;
};

export async function ensureLedgerOffscreen(): Promise<void> {
  if (!chrome.offscreen) {
    throw new LedgerError(
      LedgerErrorCode.OFFSCREEN_UNAVAILABLE,
      "Ledger support requires Chrome 124 or newer.",
    );
  }
  await ensureHardwareOffscreen();
}

async function send<T>(type: string, body: Record<string, unknown>): Promise<T> {
  try {
    const response = await withHardwareOffscreenRequest(
      () =>
        chrome.runtime.sendMessage({ type, target: TARGET, ...body }) as Promise<{
          ok?: boolean;
          payload?: T;
          error?: {
            code?: string;
            userMessage?: string;
            technicalMessage?: string;
          };
        }>,
    );
    if (response?.ok) return response.payload as T;
    throw new LedgerError(
      (response?.error?.code as LedgerErrorCode) || LedgerErrorCode.UNKNOWN,
      response?.error?.userMessage || "Ledger operation failed.",
      response?.error?.technicalMessage,
    );
  } catch (error) {
    throw normalizeLedgerError(error);
  }
}

export function connectLedger(opId: string, productName?: string) {
  return send<{ deviceId: string; deviceLabel: string; deviceModel: string }>(
    "offscreen:ledgerConnect", { opId, productName },
  );
}

export function scanLedgerAddresses(input: {
  opId: string; deviceId: string; startIndex: number; count: number;
  scheme: "ledgerLive" | "bip44" | "legacyMew" | "custom"; customTemplate?: string;
}) {
  return send<Array<{ hdPath: string; hdIndex: number; address: `0x${string}` }>>(
    "offscreen:ledgerScan", input,
  );
}

export function signLedgerTransaction(input: {
  opId: string; deviceId: string; hdPath: string; unsignedTx: `0x${string}`;
}) {
  return send<{ r: `0x${string}`; s: `0x${string}`; v: number }>(
    "offscreen:ledgerSignTx", input,
  );
}

export function signLedgerMessage(input: {
  opId: string; deviceId: string; hdPath: string; hex: `0x${string}`;
}) {
  return send<{ r: `0x${string}`; s: `0x${string}`; v: number }>(
    "offscreen:ledgerSignMessage", input,
  );
}

export function signLedgerTypedData(input: {
  opId: string; deviceId: string; hdPath: string; typedData: Record<string, unknown>;
}) {
  return send<{ r: `0x${string}`; s: `0x${string}`; v: number }>(
    "offscreen:ledgerSignTypedData", input,
  );
}

export async function cancelLedgerOperation(opId: string): Promise<void> {
  await send("offscreen:ledgerCancel", { opId });
}
