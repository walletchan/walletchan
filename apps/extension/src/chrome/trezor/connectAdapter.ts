import { WALLETCHAN_TREZOR_MANIFEST_URL } from "@/constants/externalUrls";
import type TrezorConnect from "@trezor/connect-web";
import type { CommonParams } from "@trezor/connect-web";
import {
  captureDeviceBinding,
  type ConnectDeviceBinding,
} from "./deviceBinding";
import {
  TREZOR_DEVICE_IDENTITY_PATH,
  type TrezorDerivationRow,
} from "./derivation";
import { TrezorError, TrezorErrorCode } from "./errors";
import {
  type TrezorAddress,
  type TrezorConnectedDevice,
  type TrezorMessageSignature,
  type TrezorSignedTransaction,
  type TrezorTransaction,
  type TrezorTypedDataSignature,
} from "./types";
import {
  normalizeMessageHex,
  normalizeOptionalHash,
  unwrapTrezorResponse,
  validateAddressPage,
  validateDeviceFeatures,
  validateDeviceIdentity,
  validateIdentityPayload,
  validatePath,
  validateReturnedSignature,
  validateRows,
  validateSignedTransaction,
  validateTransaction,
  validateTypedData,
} from "./connectValidation";

export type TrezorDispatchStatus = (
  status:
    | "connecting"
    | "selecting-device"
    | "awaiting-confirmation"
    | "scanning"
    | "signing"
    | "success",
) => void;

const TREZOR_MANIFEST = {
  appName: "WalletChan",
  appUrl: WALLETCHAN_TREZOR_MANIFEST_URL,
  email: "hello@walletchan.com",
} as const;

export interface ConnectOperation {
  callId: string;
  signal: AbortSignal;
}
export type ConnectSdk = Pick<
  typeof TrezorConnect,
  | "init"
  | "cancel"
  | "getFeatures"
  | "ethereumGetAddress"
  | "ethereumSignTransaction"
  | "ethereumSignMessage"
  | "ethereumSignTypedData"
>;

export function createTrezorConnectAdapter(sdk: ConnectSdk) {
  let initialization: Promise<void> | null = null;
  let activeOperation: ConnectOperation | null = null;
  let binding: ConnectDeviceBinding | undefined;

  async function connectTrezor(
    dispatch: TrezorDispatchStatus,
    operation: ConnectOperation,
  ): Promise<TrezorConnectedDevice> {
    return withDispatch(dispatch, operation, async () => {
      dispatch("connecting");
      const identity = await getIdentityAddress();
      const features = validateDeviceFeatures(
        unwrapTrezorResponse(await invoke((common) => sdk.getFeatures(common))),
      );
      dispatch("success");
      return {
        deviceId: identity,
        deviceLabel: features.label,
        deviceModel: features.model,
      };
    });
  }

  async function scanTrezorAddresses(
    deviceId: string,
    rows: TrezorDerivationRow[],
    dispatch: TrezorDispatchStatus,
    operation: ConnectOperation,
  ): Promise<TrezorAddress[]> {
    const normalizedDeviceId = validateDeviceIdentity(deviceId);
    validateRows(rows);

    return withDispatch(dispatch, operation, async () => {
      dispatch("connecting");
      await assertExpectedDevice(normalizedDeviceId);
      dispatch("scanning");
      const response = await invoke((common) =>
        sdk.ethereumGetAddress({
          ...common,
          bundle: rows.map(({ hdPath }) => ({
            path: hdPath,
            showOnTrezor: false,
          })),
        }),
      );
      const payload = unwrapTrezorResponse(response);
      const addresses = validateAddressPage(payload, rows);
      dispatch("success");
      return addresses;
    });
  }

  async function signTrezorTransaction(
    deviceId: string,
    hdPath: string,
    transaction: TrezorTransaction,
    dispatch: TrezorDispatchStatus,
    operation: ConnectOperation,
  ): Promise<TrezorSignedTransaction> {
    validateDeviceIdentity(deviceId);
    validatePath(hdPath);
    validateTransaction(transaction);

    // Suite selects the wallet for this single signing call. Callers in
    // signing.ts must recover the exact pinned account before any effect.
    return withDispatch(dispatch, operation, async () => {
      dispatch("signing");
      const response = await invoke((common) =>
        sdk.ethereumSignTransaction({
          ...common,
          path: hdPath,
          transaction,
        }),
      );
      const payload = validateSignedTransaction(unwrapTrezorResponse(response));
      dispatch("success");
      return payload;
    });
  }

  async function signTrezorMessage(
    deviceId: string,
    hdPath: string,
    message: string,
    dispatch: TrezorDispatchStatus,
    operation: ConnectOperation,
  ): Promise<TrezorMessageSignature> {
    validateDeviceIdentity(deviceId);
    validatePath(hdPath);
    const normalizedMessage = normalizeMessageHex(message);

    return withDispatch(dispatch, operation, async () => {
      dispatch("signing");
      const response = await invoke((common) =>
        sdk.ethereumSignMessage({
          ...common,
          path: hdPath,
          message: normalizedMessage,
          hex: true,
        }),
      );
      const payload = validateReturnedSignature(unwrapTrezorResponse(response));
      dispatch("success");
      return payload;
    });
  }

  async function signTrezorTypedData(
    deviceId: string,
    hdPath: string,
    typedData: Record<string, unknown>,
    domainSeparatorHash: string | undefined,
    messageHash: string | undefined,
    dispatch: TrezorDispatchStatus,
    operation: ConnectOperation,
  ): Promise<TrezorTypedDataSignature> {
    validateDeviceIdentity(deviceId);
    validatePath(hdPath);
    validateTypedData(typedData);
    const normalizedDomainHash = normalizeOptionalHash(domainSeparatorHash);
    const normalizedMessageHash = normalizeOptionalHash(messageHash);

    return withDispatch(dispatch, operation, async () => {
      dispatch("signing");
      const base = {
        path: hdPath,
        data: typedData,
        metamask_v4_compat: true,
      };
      const request = normalizedDomainHash
        ? {
            ...base,
            domain_separator_hash: normalizedDomainHash,
            message_hash: normalizedMessageHash,
          }
        : base;
      const response = await invoke((common) =>
        sdk.ethereumSignTypedData({
          ...request,
          ...common,
        } as unknown as Parameters<typeof sdk.ethereumSignTypedData>[0]),
      );
      const payload = validateReturnedSignature(unwrapTrezorResponse(response));
      dispatch("success");
      return payload;
    });
  }

  function cancel(operation: ConnectOperation): void {
    if (activeOperation === operation)
      sdk.cancel({
        callId: operation.callId,
        reason: "WalletChan cancelled the Trezor request.",
      });
  }

  async function ensureInitialized(): Promise<void> {
    if (!initialization) {
      initialization = sdk
        .init({
          manifest: TREZOR_MANIFEST,
          env: "webextension",
          coreMode: "auto",
          debug: false,
        })
        .catch((error) => {
          initialization = null;
          throw error;
        });
    }
    await initialization;
  }

  function assertActive(): void {
    if (!activeOperation || activeOperation.signal.aborted) {
      throw new TrezorError(
        TrezorErrorCode.USER_REJECTED,
        "The Trezor request was cancelled.",
      );
    }
  }

  async function invoke<R extends { success: boolean; device?: unknown }>(
    run: (common: CommonParams) => Promise<R>,
    keepSession = false,
  ): Promise<R> {
    assertActive();
    const response = await run({
      callId: activeOperation!.callId,
      keepSession,
      device: binding as CommonParams["device"],
    });
    assertActive();
    if (response.success)
      binding = captureDeviceBinding(response.device, binding);
    return response;
  }

  async function withDispatch<T>(
    dispatch: TrezorDispatchStatus,
    operation: ConnectOperation,
    run: () => Promise<T>,
  ): Promise<T> {
    if (activeOperation)
      throw new TrezorError(
        TrezorErrorCode.TRANSPORT_BUSY,
        "Another Trezor operation is in progress.",
      );
    activeOperation = operation;
    binding = undefined;
    try {
      await ensureInitialized();
      assertActive();
      dispatch("awaiting-confirmation");
      const result = await run();
      assertActive();
      return result;
    } finally {
      activeOperation = null;
      binding = undefined;
    }
  }

  async function getIdentityAddress(): Promise<`0x${string}`> {
    const response = await invoke((common) =>
      sdk.ethereumGetAddress({
        ...common,
        path: TREZOR_DEVICE_IDENTITY_PATH,
        showOnTrezor: false,
      }),
      true,
    );
    return validateIdentityPayload(
      unwrapTrezorResponse(response),
      TREZOR_DEVICE_IDENTITY_PATH,
    );
  }

  async function assertExpectedDevice(expectedDeviceId: string): Promise<void> {
    const actualDeviceId = await getIdentityAddress();
    if (actualDeviceId !== expectedDeviceId) {
      throw new TrezorError(
        TrezorErrorCode.DEVICE_DISCONNECTED,
        "Connect the Trezor used by this account and try again.",
      );
    }
  }

  return {
    connectTrezor,
    scanTrezorAddresses,
    signTrezorTransaction,
    signTrezorMessage,
    signTrezorTypedData,
    cancel,
  };
}
