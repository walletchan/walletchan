import type { Hex } from "viem";
import type { SafeCall, SafeTransactionData } from "../safe/types";
import type { GasOverrides } from "../transactions/localExecution";

export interface BunkerPlan { address: Hex; initializer: Hex; salt: string; fromBlock: string; deploymentHash?: Hex; raw?: Hex; verifiedBlock?: { number: string; hash: Hex } }
export interface BunkerRoute {
  kind: "wallet" | "injected" | "walletConnect" | "batch";
  origin: string;
  requestId: string;
  tabId?: number;
  frameId?: number;
  topic?: string;
  remoteId?: number;
}
export interface BunkerReview {
  digest: Hex; expiresAt: number; payerId: string; payerAddress: Hex;
  ownerIndex: number; nextIndex: number; nonce: number; configEpoch: string;
  transaction: SafeTransactionData; safeTxHash: Hex;
  gas: GasOverrides; maxFee: string;
}
export type BunkerOperationStatus = "queued" | "reviewed" | "signed" | "ambiguous" | "pending" | "confirmed" | "reverted" | "rejected" | "invalidated";
export interface BunkerOperation {
  id: string; calls: SafeCall[]; routes: BunkerRoute[];
  kind: "transaction" | "recovery"; state: BunkerOperationStatus;
  createdAt: number; review?: BunkerReview; signature?: Hex;
  outer?: { raw: Hex; hash: Hex; payerId: string; payerAddress: Hex };
  receipt?: { hash: Hex; block: string; blockHash: Hex; timestamp: number };
  error?: string;
  published?: boolean;
  resultPublished?: boolean;
  scanBlock?: string;
  members?: { id: string; calls: SafeCall[]; routes: BunkerRoute[]; createdAt: number }[];
}
export interface BunkerState {
  version: 2; chainId: number; chainName: string; seedGroupId: string; id: string; accountId: string; plan: BunkerPlan;
  activated: boolean; archived: boolean; ownerIndex: number; nextIndex: number;
  exposureUnknown: boolean; usedOwners: Hex[];
  defaultPayer: { id: string; address: Hex } | null;
  operations: BunkerOperation[];
  recovery: { targetOwner?: Hex; scanBlock: string; targetBlock: string; deriveIndex: number; matchedIndex: number | null; usedOwners: Hex[] } | null;
}
export interface BunkerRotation { oldOwner: string; newOwner: string; oldIndex: number; newIndex: number }
export interface BunkerOperationSummary {
  rotation?: BunkerRotation;
  id: string; calls: SafeCall[]; origins: string[]; kind: BunkerOperation["kind"];
  state: BunkerOperationStatus; createdAt: number; txHash?: Hex; error?: string;
  payerId?: string; payerAddress?: Hex; maxFee?: string; gas?: GasOverrides; reviewDigest?: Hex; reviewExpiresAt?: number;
}
export interface BunkerAccountView {
  id: string; draftId: string; name: string; safeAddress: Hex; chainId: number; chainName: string; explorer: string; nativeCurrencySymbol: string;
  deployed: boolean; archived: boolean; exposureUnknown: boolean; ownerIndex?: number;
  defaultPayer: BunkerState["defaultPayer"]; operations: BunkerOperationSummary[];
  seedGroupId: string;
  deploymentPayerId?: string; deploymentGas?: GasOverrides;
  deploymentHash?: Hex; recovering: boolean; recoveryProgress?: string;
}
