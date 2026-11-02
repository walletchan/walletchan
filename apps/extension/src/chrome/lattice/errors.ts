import {
  LatticeProtocolError,
  LatticeResponseCode,
  LatticeTransportError,
} from "./protocol";

/** Stable user-facing error vocabulary for Lattice operations. */
export const LatticeErrorCode = {
  USER_REJECTED: "USER_REJECTED",
  DEVICE_OFFLINE: "DEVICE_OFFLINE",
  DEVICE_LOCKED: "DEVICE_LOCKED",
  DEVICE_BUSY: "DEVICE_BUSY",
  NOT_PAIRED: "NOT_PAIRED",
  PAIRING_FAILED: "PAIRING_FAILED",
  SETUP_EXPIRED: "SETUP_EXPIRED",
  WRONG_WALLET: "WRONG_WALLET",
  FIRMWARE_TOO_OLD: "FIRMWARE_TOO_OLD",
  TIMEOUT: "TIMEOUT",
  CANCELLED: "CANCELLED",
  NOT_CONFIGURED: "NOT_CONFIGURED",
  WALLET_LOCKED: "WALLET_LOCKED",
  UNKNOWN: "UNKNOWN",
} as const;
export type LatticeErrorCode = (typeof LatticeErrorCode)[keyof typeof LatticeErrorCode];

/** Shared by every path that finds the device or key unpaired. */
export const NOT_PAIRED_MESSAGE = "Lattice not paired. Remove it and add it again.";

export class LatticeError extends Error {
  constructor(
    readonly code: LatticeErrorCode,
    readonly userMessage: string,
    readonly technicalMessage = userMessage,
  ) {
    super(userMessage);
    this.name = "LatticeError";
  }
}

const TIMED_OUT: [LatticeErrorCode, string] = [LatticeErrorCode.TIMEOUT, "Your Lattice timed out."];
const RESPONSE_CODE_ERRORS: Record<number, [LatticeErrorCode, string]> = {
  [LatticeResponseCode.USER_DECLINED]: [LatticeErrorCode.USER_REJECTED, "Rejected on your Lattice."],
  [LatticeResponseCode.USER_TIMEOUT]: TIMED_OUT,
  [LatticeResponseCode.GCE_TIMEOUT]: TIMED_OUT,
  [LatticeResponseCode.DEVICE_BUSY]: [
    LatticeErrorCode.DEVICE_BUSY,
    "Your Lattice is busy.",
  ],
  [LatticeResponseCode.PAIR_FAILED]: [
    LatticeErrorCode.PAIRING_FAILED,
    "Pairing failed. Check the code.",
  ],
  [LatticeResponseCode.PAIR_DISABLED]: [LatticeErrorCode.PAIRING_FAILED, "Pairing is disabled on your Lattice."],
  [LatticeResponseCode.PERMISSION_DISABLED]: [
    LatticeErrorCode.NOT_PAIRED,
    NOT_PAIRED_MESSAGE,
  ],
  [LatticeResponseCode.WRONG_WALLET]: [
    LatticeErrorCode.WRONG_WALLET,
    "Your Lattice's active wallet changed.",
  ],
  [LatticeResponseCode.DEVICE_LOCKED]: [LatticeErrorCode.DEVICE_LOCKED, "Unlock your Lattice."],
};

export function normalizeLatticeError(error: unknown): LatticeError {
  if (error instanceof LatticeError) return error;
  const technical = error instanceof Error ? error.message || error.name : String(error);
  if (error instanceof LatticeProtocolError && error.responseCode !== null) {
    const mapped = RESPONSE_CODE_ERRORS[error.responseCode];
    if (mapped) return new LatticeError(mapped[0], mapped[1], technical);
  }
  const lower = technical.toLowerCase();
  if (lower.includes("cancelled")) {
    return new LatticeError(LatticeErrorCode.CANCELLED, "Lattice request cancelled.", technical);
  }
  if (lower.includes("older than the supported minimum")) {
    return new LatticeError(LatticeErrorCode.FIRMWARE_TOO_OLD, "Update your Lattice firmware.", technical);
  }
  if (error instanceof LatticeTransportError) {
    return new LatticeError(
      LatticeErrorCode.DEVICE_OFFLINE,
      "Could not reach your Lattice. Check that it is online.",
      technical,
    );
  }
  return new LatticeError(
    LatticeErrorCode.UNKNOWN,
    "Lattice request failed. Try again.",
    technical,
  );
}
