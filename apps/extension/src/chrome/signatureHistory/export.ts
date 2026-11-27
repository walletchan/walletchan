import { getSafeProposals } from "../safe/proposalRepository";
import { countHistoryTransactions } from "../history/database";
import { getTxHistory } from "../history/repository";
import {
  getAuthCeremonyEpoch,
  isCurrentAuthCeremonyEpoch,
} from "../authTransition";
import { getCachedVaultKey, getPasswordType } from "../sessionCache";
import { getSignatureHistory, clearSignatureHistory } from "./repository";
import { matchesSignatureFilter } from "./model";
import { MAX_SIGNATURE_BYTES, MAX_SIGNATURE_ROWS } from "./database";
import type {
  SignatureHistoryFilter,
  SignatureHistoryAccount,
  SignatureHistoryEntry,
} from "./types";

export function parseHistoryFilter(value: unknown): SignatureHistoryFilter {
  const input = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;
  const filter: SignatureHistoryFilter = {};
  if (input.ownerAddress !== undefined) {
    if (
      typeof input.ownerAddress !== "string" ||
      !/^0x[\da-f]{40}$/i.test(input.ownerAddress)
    )
      throw new Error("Invalid account filter");
    filter.ownerAddress = input.ownerAddress.toLowerCase();
  }
  if (input.chainId !== undefined && input.chainId !== null) {
    if (!Number.isSafeInteger(input.chainId) || Number(input.chainId) < 1)
      throw new Error("Invalid network filter");
    filter.chainId = Number(input.chainId);
  }
  for (const key of ["from", "to"] as const) {
    if (input[key] !== undefined) {
      if (!Number.isSafeInteger(input[key]) || Number(input[key]) < 0)
        throw new Error("Invalid date filter");
      filter[key] = Number(input[key]);
    }
  }
  if (
    filter.from !== undefined &&
    filter.to !== undefined &&
    filter.from > filter.to
  )
    throw new Error("Start date must precede end date");
  return filter;
}
export async function getActivityHistorySummary(filter: SignatureHistoryFilter) {
  const [transactions, proposals] = await Promise.all([countHistoryTransactions(filter), getSafeProposals()]);
  const safeCount = proposals.filter(proposal => matchesSignatureFilter({
    ownerAddress: proposal.safeAddress, chainId: proposal.chainId, createdAt: proposal.executionAt ?? proposal.createdAt,
  }, filter)).length;
  const history = await getSignatureHistory(filter);
  return { ...history, transactionCount: transactions + safeCount };
}
export async function exportActivity(filter: SignatureHistoryFilter) {
  const { entries: signatures, state } = await getSignatureHistory(filter);
  const epoch = getAuthCeremonyEpoch();
  const key = getCachedVaultKey();
  const history = await getTxHistory();
  // Explicit projection excludes raw transaction bytes, authorization lists, RPC URLs,
  // error strings, credential tags, and internal recovery payloads.
  const transactions = history
    .filter((tx) =>
      matchesSignatureFilter(
        {
          ownerAddress: tx.tx.from.toLowerCase(),
          chainId: tx.chainId,
          createdAt: tx.createdAt,
        },
        filter,
      ),
    )
    .map((tx) => ({
      id: tx.id,
      status: tx.status,
      createdAt: tx.createdAt,
      completedAt: tx.completedAt,
      accountId: tx.accountId,
      accountType: tx.accountType,
      chainId: tx.chainId,
      chainName: tx.chainName,
      origin: tx.origin,
      txHash: tx.txHash,
      userOperationHash: tx.userOperationHash,
      functionName: tx.functionName,
      tx: { from: tx.tx.from, to: tx.tx.to, value: tx.tx.value },
      calldataSelector: tx.calldataSelector,
      gasData: tx.gasData,
      assetChanges: tx.assetChanges,
      destAssetChanges: tx.destAssetChanges,
      bridge: tx.bridge,
      safeExecutionMeta: tx.safeExecutionMeta,
    }));
  const safeTransactions = (await getSafeProposals())
    .filter((proposal) =>
      matchesSignatureFilter(
        {
          ownerAddress: proposal.safeAddress,
          chainId: proposal.chainId,
          createdAt: proposal.executionAt ?? proposal.createdAt,
        },
        filter,
      ),
    )
    .map((proposal) => ({
      id: proposal.id,
      safeAddress: proposal.safeAddress,
      chainId: proposal.chainId,
      status: proposal.state,
      createdAt: proposal.createdAt,
      executionAt: proposal.executionAt,
      origin: proposal.route.origin,
      transactionHash: proposal.transactionHash,
      userOperationHash: proposal.userOperationHash,
      nonce: proposal.transaction.nonce,
      to: proposal.transaction.to,
      value: proposal.transaction.value,
      operation: proposal.transaction.operation,
    }));
  if (
    !key ||
    !isCurrentAuthCeremonyEpoch(epoch) ||
    getCachedVaultKey() !== key ||
    !getPasswordType()
  )
    throw new Error("Wallet locked while exporting activity");
  const accounts: Record<
    string,
    {
      address: string;
      type: SignatureHistoryAccount["type"];
      signatures: Omit<
        SignatureHistoryEntry,
        "accountId" | "accountType" | "ownerAddress" | "version"
      >[];
    }
  > = Object.create(null);
  for (const entry of signatures) {
    const {
      accountId,
      accountType,
      ownerAddress,
      version: _version,
      ...signature
    } = entry;
    const account = (accounts[accountId] ??= {
      address: ownerAddress,
      type: accountType,
      signatures: [],
    });
    account.signatures.push(signature);
  }
  return {
    schemaVersion: 2,
    application: "WalletChan",
    applicationVersion: chrome.runtime.getManifest?.().version ?? "unknown",
    exportedAt: new Date().toISOString(),
    filter,
    coverage: {
      ...state,
      signatureRowLimit: MAX_SIGNATURE_ROWS,
      signatureByteLimit: MAX_SIGNATURE_BYTES,
      rawSignaturesIncluded: false,
      transactionCalldataIncluded: false,
      meaning:
        "Signatures authorized for release or committed wallet authorizations; delivery and onchain execution are separate.",
    },
    transactions,
    safeTransactions,
    accounts,
  };
}

/** Status-route dependencies kept together at their owning feature boundary. */
export const ACTIVITY_HISTORY_ROUTES = {
  getActivityHistorySummary,
  getSignatureHistory,
  clearSignatureHistory,
  exportActivity,
};
