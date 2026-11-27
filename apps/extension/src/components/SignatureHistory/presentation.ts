import type {
  SignatureHistoryEntry,
  SignatureKind,
} from "@/chrome/signatureHistory/types";
const LABELS: Record<SignatureKind, string> = {
  message: "Signed message",
  siwe: "Signed in",
  typedData: "Signed typed data",
  safeApproval: "Approved Safe transaction",
  sponsoredTransfer: "Authorized transfer",
  permission: "Granted permission",
  userOperation: "Authorized gas payment",
};
export function signatureTitle(entry: SignatureHistoryEntry): string {
  return LABELS[entry.kind] ?? "Signed message";
}
export function signatureOrigin(origin: string): string {
  if (
    origin === "wallet" ||
    origin === "internal" ||
    origin.startsWith("walletchan:")
  )
    return "WalletChan";
  try {
    return new URL(origin).host || origin;
  } catch {
    return origin;
  }
}
export function signaturePayload(entry: SignatureHistoryEntry): string {
  if (typeof entry.payload !== "string")
    return JSON.stringify(entry.payload, null, 2);
  if (/^0x(?:[0-9a-f]{2})*$/i.test(entry.payload)) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(
        Uint8Array.from(entry.payload.slice(2).match(/../g) ?? [], (byte) =>
          parseInt(byte, 16),
        ),
      );
    } catch {
      return entry.payload;
    }
  }
  return entry.payload;
}
