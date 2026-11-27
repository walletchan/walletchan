/** Exact ERC-3009 history projection; the submission owner controls its commit. */
import { prepareSignatureHistory } from "../signatureHistory/repository";
import { typedDataHistoryEntry } from "../signatureHistory/model";
import { USDC_DOMAIN, TRANSFER_WITH_AUTHORIZATION_TYPES } from "./constants";
import type { SponsoredTransferIntentRecord, SponsoredTransferRelayPayload } from "./intentStorage";
import type { SponsoredTransferSignerAccount } from "./types";

export function prepareSponsoredSignatureHistory(
  account: SponsoredTransferSignerAccount,
  record: SponsoredTransferIntentRecord,
  payload: SponsoredTransferRelayPayload,
) {
  return prepareSignatureHistory(typedDataHistoryEntry({
    id: `sponsored:${record.id}:${payload.nonce}`, account, origin: "wallet", chainId: 8453,
    kind: "sponsoredTransfer",
    typedData: {
      domain: USDC_DOMAIN, types: TRANSFER_WITH_AUTHORIZATION_TYPES, primaryType: "TransferWithAuthorization",
      message: {
        from: payload.from, to: payload.to, value: payload.value,
        validAfter: payload.validAfter, validBefore: payload.validBefore, nonce: payload.nonce,
      },
    },
  }));
}
