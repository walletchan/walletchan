import { looksLikeSiweMessage } from "../../lib/siwe/parser";
import { hashMessage, hashTypedData, isHex, type Hex } from "viem";
import type { DirectSigningAccount } from "../accounts/accountTypePolicy";
import type { PendingSignatureRequest } from "../requests/pendingSignatureStorage";
import type {
  SignatureHistoryEntry,
  SignatureHistoryFilter,
  SignatureKind,
} from "./types";

export function jsonSafe(value: unknown): string {
  return JSON.stringify(value, (_key, child) =>
    typeof child === "bigint" ? child.toString() : child,
  );
}
export function matchesSignatureFilter(
  entry: Pick<SignatureHistoryEntry, "ownerAddress" | "chainId" | "createdAt">,
  filter: SignatureHistoryFilter,
): boolean {
  return (
    (!filter.ownerAddress ||
      entry.ownerAddress === filter.ownerAddress.toLowerCase()) &&
    (filter.chainId == null || entry.chainId === filter.chainId) &&
    (filter.from === undefined || entry.createdAt >= filter.from) &&
    (filter.to === undefined || entry.createdAt <= filter.to)
  );
}

export function typedDataHistoryEntry(input: {
  id: string;
  account: DirectSigningAccount;
  origin: string;
  source?: SignatureHistoryEntry["source"];
  chainId: number;
  typedData: unknown;
  kind: SignatureKind;
  safeAddress?: string;
}): SignatureHistoryEntry {
  const data = (
    typeof input.typedData === "string"
      ? JSON.parse(input.typedData)
      : input.typedData
  ) as Parameters<typeof hashTypedData>[0];
  // Own only the fields the EIP-712 signer actually consumes.
  const payload = {
    domain: data.domain,
    types: data.types,
    primaryType: data.primaryType,
    message: data.message,
  };
  return {
    version: 1,
    id: input.id,
    createdAt: Date.now(),
    accountId: input.account.id,
    ownerAddress: input.account.address.toLowerCase(),
    accountType: input.account.type,
    origin: input.origin,
    source: input.source ?? "wallet",
    method: "eth_signTypedData_v4",
    kind: input.kind,
    chainId: input.chainId,
    digest: hashTypedData(payload),
    payload: JSON.parse(jsonSafe(payload)),
    ...(input.safeAddress ? { safeAddress: input.safeAddress } : {}),
  };
}

export function pendingSignatureHistoryEntry(
  pending: PendingSignatureRequest,
  account: DirectSigningAccount,
): SignatureHistoryEntry {
  const source = pending.walletConnect
    ? "walletconnect"
    : pending.trustedInternal
      ? "wallet"
      : "injected";
  const origin = pending.senderOrigin ?? pending.origin;
  if (pending.signature.method !== "personal_sign") {
    return {
      ...typedDataHistoryEntry({
        id: `request:${pending.id}`,
        account,
        origin,
        source,
        chainId: pending.signature.chainId,
        typedData: pending.signature.params[1],
        kind: "typedData",
      }),
      method: pending.signature.method,
    };
  }
  const payload = pending.signature.params[0] as string;
  let text = payload;
  if (isHex(payload)) {
    text = new TextDecoder().decode(
      Uint8Array.from(payload.slice(2).match(/../g) ?? [], (byte) =>
        parseInt(byte, 16),
      ),
    );
  }
  return {
    version: 1,
    id: `request:${pending.id}`,
    createdAt: Date.now(),
    accountId: account.id,
    ownerAddress: account.address.toLowerCase(),
    accountType: account.type,
    origin,
    source,
    method: pending.signature.method,
    kind: looksLikeSiweMessage(text) ? "siwe" : "message",
    chainId: pending.signature.chainId,
    digest: hashMessage(isHex(payload) ? { raw: payload as Hex } : payload),
    payload,
  };
}
