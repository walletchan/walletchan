import {
  beginPendingRequestEffectLease,
  guardPendingRequestEffectLease,
} from "../requests/pendingRequestResolution";
import { enforcePendingRequestAuthorizationAtConfirmation } from "../requests/pendingRequestLifecycle";
import { revalidatePendingSignatureBeforeRelease } from "../requests/pendingSignatureRelease";
import { removePendingSignatureRequest } from "../requests/pendingSignatureStorage";
import type { SignatureResult } from "../transactions/runtime";
import { prepareSignatureConfirmation } from "../signatures/confirmationPolicy";
import { ensureLedgerSigningSession } from "./session";
import { signLedgerSignatureRequest } from "./signing";
import { ensureTrezorSigningSession } from "../trezor/session";
import { createTrezorOperationId } from "../trezor/operationId";
import { signTrezorSignatureRequest } from "../trezor/signing";

type HardwareProvider = "ledger" | "trezor";

/** Confirms a pinned Ledger message or EIP-712 signature request. */
export async function handleConfirmLedgerSignatureRequest(
  sigId: string,
  password: string,
  _tabId?: number,
  allowUnsafeSiwe = false,
): Promise<SignatureResult> {
  return handleConfirmHardwareSignatureRequest(
    "ledger",
    sigId,
    password,
    _tabId,
    allowUnsafeSiwe,
  );
}

/** Confirms a pinned Trezor message or EIP-712 signature request. */
export async function handleConfirmTrezorSignatureRequest(
  sigId: string,
  password: string,
  _tabId?: number,
  allowUnsafeSiwe = false,
): Promise<SignatureResult> {
  return handleConfirmHardwareSignatureRequest(
    "trezor",
    sigId,
    password,
    _tabId,
    allowUnsafeSiwe,
  );
}

async function handleConfirmHardwareSignatureRequest(
  provider: HardwareProvider,
  sigId: string,
  password: string,
  _tabId?: number,
  allowUnsafeSiwe = false,
): Promise<SignatureResult> {
  const preflight = await prepareSignatureConfirmation(sigId, allowUnsafeSiwe);
  if (!preflight.ok) return preflight.result;
  const { pending, account } = preflight.value;
  if (account.type !== provider) {
    return { success: false, error: "Pending request is no longer valid" };
  }

  try {
    if (account.type === "ledger") {
      await ensureLedgerSigningSession(password);
    } else {
      await ensureTrezorSigningSession(password);
    }
    const authorization = await enforcePendingRequestAuthorizationAtConfirmation(
      "signature",
      pending,
    );
    if (!authorization.authorized) {
      return { success: false, error: authorization.error };
    }
    const lease = beginPendingRequestEffectLease("signature", sigId);
    if (!lease) return { success: false, error: "Wallet reset is in progress" };
    const effectGuard = guardPendingRequestEffectLease(lease);
    try {
      effectGuard.beginEffect();
      let signature: `0x${string}`;
      try {
        if (account.type === "ledger") {
          signature = await signLedgerSignatureRequest({
            opId: sigId,
            account,
            method: pending.signature.method,
            params: pending.signature.params,
            chainId: pending.signature.chainId,
          });
        } else {
          signature = await signTrezorSignatureRequest({
            opId: createTrezorOperationId(),
            account,
            method: pending.signature.method,
            params: pending.signature.params,
            chainId: pending.signature.chainId,
          });
        }
        effectGuard.settleEffect();
      } catch (error) {
        effectGuard.settleEffect();
        throw error;
      }
      const finalAuthorization = await revalidatePendingSignatureBeforeRelease(
        pending,
        provider,
        {
          deviceId: account.deviceId,
          hdPath: account.hdPath,
        },
      );
      if (!finalAuthorization.authorized) {
        // Signing finished but authority moved: terminalize the request so the
        // background publishes the rejection instead of leaving the dapp waiting.
        await removePendingSignatureRequest(sigId);
        return { success: false, error: finalAuthorization.error };
      }
      await removePendingSignatureRequest(sigId);
      return { success: true, signature };
    } finally {
      effectGuard.releaseIfSafe();
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : `${provider === "ledger" ? "Ledger" : "Trezor"} signing failed`,
    };
  }
}
