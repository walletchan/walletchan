import { useEffect, useRef, useState } from "react";
import type { GasOverrides } from "@/chrome/txHandlers";
import type { PendingTxRequest } from "@/chrome/requests/pendingTxStorage";
import { playInteractionSound } from "@/sounds/soundManager";
import type {
  ConfirmationState,
  TransactionAccountType,
} from "./types";

interface UseTransactionActionsOptions {
  txRequest: PendingTxRequest;
  accountType?: TransactionAccountType;
  canSendImpersonatedTransaction: boolean;
  isInSidePanel: boolean;
  isErc7715PermissionRevoke: boolean;
  is7702Revoke: boolean;
  is7702SetDelegate: boolean;
  decodedFunctionName?: string;
  gasOverrides: GasOverrides | null;
  forceInclusion: boolean;
  feePaymentToken: "native" | `0x${string}`;
  feePaymentQuoteId: string | null;
  nonce: number | null;
  onConfirmed: () => void;
  onRejected: () => void;
  onBeforeReject?: () => void;
  onAddedToBatch?: () => void;
  onRetryReview?: () => void;
}

export function useTransactionActions({
  txRequest,
  accountType,
  canSendImpersonatedTransaction,
  isInSidePanel,
  isErc7715PermissionRevoke,
  is7702Revoke,
  is7702SetDelegate,
  decodedFunctionName,
  gasOverrides,
  forceInclusion,
  feePaymentToken,
  feePaymentQuoteId,
  nonce,
  onConfirmed,
  onRejected,
  onBeforeReject,
  onAddedToBatch,
  onRetryReview,
}: UseTransactionActionsOptions) {
  const [state, setState] = useState<ConfirmationState>("ready");
  const [error, setError] = useState("");
  const [isRejecting, setIsRejecting] = useState(false);
  const [isAddingToBatch, setIsAddingToBatch] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryUnavailable, setRetryUnavailable] = useState(false);
  const [retryRevision, setRetryRevision] = useState(0);
  const retryAttempt = useRef(0);
  const retryLocked = useRef(false);
  useEffect(() => {
    retryLocked.current = false;
    setIsRetrying(false);
    setRetryUnavailable(false);
    const attemptRef = retryAttempt;
    return () => { attemptRef.current++; };
  }, [txRequest.id]);
  const handleRetry = async () => {
    if ((state !== "error" && state !== "ready") || retryLocked.current || isRejecting || isAddingToBatch || retryUnavailable) return;
    retryLocked.current = true;
    const attempt = ++retryAttempt.current;
    setIsRetrying(true);
    try {
      const pending = await new Promise<{ tx?: unknown } | null>((resolve, reject) => {
        chrome.runtime.sendMessage({ type: "getPendingTransaction", txId: txRequest.id }, (response) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message || "Could not refresh request"));
          else resolve(response ?? null);
        });
      });
      if (attempt !== retryAttempt.current) return;
      if (!pending?.tx) {
        setState("error");
        setRetryUnavailable(true);
        setError("This request is no longer pending. Check Activity for its status.");
        return;
      }
      onRetryReview?.();
      setRetryRevision((revision) => revision + 1);
      setError("");
      setState("ready");
    } catch (cause) {
      if (attempt === retryAttempt.current) {
        setState("error");
        setError(cause instanceof Error ? cause.message : "Could not refresh request");
      }
    } finally {
      if (attempt === retryAttempt.current) { retryLocked.current = false; setIsRetrying(false); }
    }
  };
  const { tx } = txRequest;

  const handleAddToBatch = () => {
    if (isAddingToBatch || retryLocked.current) return;
    setIsAddingToBatch(true);
    chrome.runtime.sendMessage(
      { type: "addToCrossDappBatch", txId: txRequest.id },
      (result: { success: boolean; error?: string } | undefined) => {
        if (!result?.success) {
          setIsAddingToBatch(false);
          setError(result?.error || "Failed to add to batch");
          setState("error");
          return;
        }
        if (onAddedToBatch) onAddedToBatch();
        else setIsAddingToBatch(false);
      },
    );
  };

  const handleConfirm = async () => {
    if (retryLocked.current || state === "submitting" || isRejecting) return;
    void playInteractionSound("transactionConfirm");
    setState("submitting");
    setError("");
    const isPrivacyOperation = !!(
      txRequest.privacyShieldMeta ||
      txRequest.privacyRagequitMeta ||
      txRequest.privacyUnshieldMeta
    );
    const shouldForceInclusion = forceInclusion && !isPrivacyOperation;
    const messageType =
      accountType === "impersonator" && canSendImpersonatedTransaction
        ? "confirmImpersonatedTransaction"
        : accountType === "ledger"
        ? "confirmTransactionAsyncLedger"
        : accountType === "trezor"
        ? "confirmTransactionAsyncTrezor"
        : accountType === "privateKey" || accountType === "seedPhrase"
          ? "confirmTransactionAsyncPK"
          : "confirmTransactionAsync";
    const functionName = txRequest.replacement?.kind === "cancel"
      ? "Cancel Transaction"
      : txRequest.replacement?.originalFunctionName ??
        (txRequest.privacyRagequitMeta
          ? "Recover Shield balance"
          : txRequest.privacyUnshieldMeta
            ? "Receiver-paid Unshield"
            : txRequest.privacyShieldMeta
              ? "Shield ETH"
              : isErc7715PermissionRevoke
                ? "Revoke delegated permission"
                : is7702Revoke
                  ? "Revoke smart-account delegation"
                  : is7702SetDelegate
                    ? "Set smart-account delegation"
                    : !tx.to
                      ? "Contract Deployment"
                      : decodedFunctionName || undefined);

    chrome.runtime.sendMessage(
      {
        type: messageType,
        txId: txRequest.id,
        password: "",
        functionName,
        ...(gasOverrides ? { gasOverrides } : {}),
        ...(shouldForceInclusion ? { forceInclusion: true } : {}),
        ...(nonce !== null ? { nonce } : {}),
        feePaymentToken:
          isPrivacyOperation || feePaymentToken === "native"
            ? "native"
            : "token",
        ...(feePaymentQuoteId ? { feePaymentQuoteId } : {}),
      },
      (result: { success: boolean; error?: string } | undefined) => {
        const transportError = chrome.runtime.lastError?.message;
        if (!transportError && result?.success) {
          if (shouldForceInclusion) setState("forceInclusion");
          else if (isInSidePanel) onConfirmed();
          else {
            setState("sent");
            setTimeout(() => window.close(), 1000);
          }
        } else {
          setError(transportError || result?.error || "Failed to submit transaction");
          setState("error");
        }
      },
    );
  };

  const handleReject = () => {
    if (isRejecting || retryLocked.current) return;
    setIsRejecting(true);
    onBeforeReject?.();
    chrome.runtime.sendMessage(
      { type: "rejectTransaction", txId: txRequest.id },
      () => {
        onRejected();
      },
    );
  };

  const handleForceInclusionComplete = () => {
    if (isInSidePanel) onConfirmed();
    else {
      setState("sent");
      setTimeout(() => window.close(), 1500);
    }
  };

  const handleForceInclusionError = (message: string) => {
    setError(message);
    setState("error");
  };

  return {
    error,
    handleAddToBatch,
    handleConfirm,
    handleForceInclusionComplete,
    handleForceInclusionError,
    handleReject,
    handleRetry,
    isRetrying,
    retryRevision,
    retryUnavailable,
    isAddingToBatch,
    isRejecting,
    state,
  };
}
