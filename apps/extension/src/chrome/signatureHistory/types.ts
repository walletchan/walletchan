import type { DirectSigningAccount } from "../accounts/accountTypePolicy";
import type { EncryptedData } from "../crypto";

export type SignatureKind =
  | "message"
  | "siwe"
  | "typedData"
  | "safeApproval"
  | "sponsoredTransfer"
  | "permission"
  | "userOperation";
export interface SignatureHistoryEntry {
  version: 1;
  id: string;
  createdAt: number;
  accountId: string;
  ownerAddress: string;
  accountType: DirectSigningAccount["type"];
  origin: string;
  source: "injected" | "walletconnect" | "wallet";
  method: string;
  kind: SignatureKind;
  chainId: number;
  digest: string;
  /** Exact signed bytes (hex/text) or EIP-712 signing projection. No signature bytes. */
  payload: unknown;
  safeAddress?: string;
}
export interface SignatureHistoryAccount {
  id: string;
  address: string;
  type: DirectSigningAccount["type"];
}
export interface StoredSignatureAccount {
  id: string;
  encrypted: EncryptedData;
  bytes: number;
}
/** Disk content references shared account metadata rather than repeating its type. */
export type CompactSignatureEntry = Omit<
  SignatureHistoryEntry,
  "accountType" | "ownerAddress"
>;
export interface StoredSignature {
  id: string;
  ownerAddress: string;
  createdAt: number;
  accountId: string;
  encrypted: EncryptedData;
  bytes: number;
}
export interface SignatureHistoryState {
  recordingStartedAt: number | null;
  prunedCount: number;
}
export interface SignatureHistoryFilter {
  ownerAddress?: string;
  chainId?: number | null;
  from?: number;
  to?: number;
}
