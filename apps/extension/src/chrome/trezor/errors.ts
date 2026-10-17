/** Stable, bounded error vocabulary for Trezor Connect operations. */
export enum TrezorErrorCode {
  USER_REJECTED = "USER_REJECTED",
  DEVICE_DISCONNECTED = "DEVICE_DISCONNECTED",
  TRANSPORT_MISSING = "TRANSPORT_MISSING",
  TRANSPORT_BUSY = "TRANSPORT_BUSY",
  FIRMWARE_TOO_OLD = "FIRMWARE_TOO_OLD",
  CAPABILITY_UNSUPPORTED = "CAPABILITY_UNSUPPORTED",
  DEVICE_LOCKED = "DEVICE_LOCKED",
  POPUP_CLOSED = "POPUP_CLOSED",
  TIMEOUT = "TIMEOUT",
  INVALID_RESPONSE = "INVALID_RESPONSE",
  OFFSCREEN_UNAVAILABLE = "OFFSCREEN_UNAVAILABLE",
  NOT_ENABLED = "NOT_ENABLED",
  UNKNOWN = "UNKNOWN",
}

export class TrezorError extends Error {
  constructor(
    readonly code: TrezorErrorCode,
    readonly userMessage: string,
    readonly technicalMessage = userMessage,
  ) {
    super(userMessage);
    this.name = "TrezorError";
  }
}

const CODE_MESSAGES: Readonly<
  Record<string, readonly [TrezorErrorCode, string]>
> = {
  Failure_ActionCancelled: [
    TrezorErrorCode.USER_REJECTED,
    "Rejected on your Trezor.",
  ],
  Method_Cancel: [
    TrezorErrorCode.USER_REJECTED,
    "The Trezor request was cancelled.",
  ],
  Method_Interrupted: [
    TrezorErrorCode.POPUP_CLOSED,
    "The Trezor approval window was closed.",
  ],
  Device_Disconnected: [
    TrezorErrorCode.DEVICE_DISCONNECTED,
    "Reconnect your Trezor and try again.",
  ],
  Transport_Missing: [
    TrezorErrorCode.TRANSPORT_MISSING,
    "Connect your Trezor or open Trezor Suite, then try again.",
  ],
  Transport_Busy: [
    TrezorErrorCode.TRANSPORT_BUSY,
    "Close other apps using your Trezor, then try again.",
  ],
  Device_FirmwareVersion: [
    TrezorErrorCode.FIRMWARE_TOO_OLD,
    "Update your Trezor firmware and try again.",
  ],
  Device_UsedElsewhere: [
    TrezorErrorCode.TRANSPORT_BUSY,
    "Your Trezor is being used by another app.",
  ],
  Device_Locked: [
    TrezorErrorCode.DEVICE_LOCKED,
    "Unlock your Trezor and try again.",
  ],
};

export function normalizeTrezorError(error: unknown): TrezorError {
  if (error instanceof TrezorError) return error;

  const technical = boundedTechnicalMessage(error);
  const code = extractCode(error);
  const known = code ? CODE_MESSAGES[code] : undefined;
  if (known) return new TrezorError(known[0], known[1], technical);

  const lower = technical.toLowerCase();
  if (
    lower.includes("cancel") ||
    lower.includes("rejected") ||
    lower.includes("denied")
  ) {
    return new TrezorError(
      TrezorErrorCode.USER_REJECTED,
      "Rejected on your Trezor.",
      technical,
    );
  }
  if (lower.includes("disconnect") || lower.includes("device not found")) {
    return new TrezorError(
      TrezorErrorCode.DEVICE_DISCONNECTED,
      "Reconnect your Trezor and try again.",
      technical,
    );
  }
  if (lower.includes("busy") || lower.includes("used elsewhere")) {
    return new TrezorError(
      TrezorErrorCode.TRANSPORT_BUSY,
      "Close other apps using your Trezor, then try again.",
      technical,
    );
  }
  if (lower.includes("popup") && lower.includes("closed")) {
    return new TrezorError(
      TrezorErrorCode.POPUP_CLOSED,
      "The Trezor approval window was closed.",
      technical,
    );
  }
  return new TrezorError(
    TrezorErrorCode.UNKNOWN,
    "Something went wrong while talking to your Trezor. Try again.",
    technical,
  );
}

function extractCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = error as Record<string, unknown>;
  if (typeof value.code === "string") return value.code.slice(0, 128);
  if (value.payload && typeof value.payload === "object") {
    const payloadCode = (value.payload as Record<string, unknown>).code;
    if (typeof payloadCode === "string") return payloadCode.slice(0, 128);
  }
  return undefined;
}

function boundedTechnicalMessage(error: unknown): string {
  let message = "Unknown Trezor error";
  if (error instanceof Error) {
    message = error.message || error.name;
  } else if (typeof error === "string") {
    message = error;
  } else if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    const payload =
      value.payload && typeof value.payload === "object"
        ? (value.payload as Record<string, unknown>)
        : undefined;
    if (typeof payload?.error === "string") message = payload.error;
    else if (typeof value.error === "string") message = value.error;
    else if (typeof value.code === "string") message = value.code;
  }
  return Array.from(message, (character) => {
    const codePoint = character.charCodeAt(0);
    return codePoint <= 0x1f || codePoint === 0x7f ? " " : character;
  })
    .join("")
    .trim()
    .slice(0, 512);
}
