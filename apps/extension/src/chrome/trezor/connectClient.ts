import { trezorConnectAdapter } from "./connectSdk";
import type { ConnectOperation, TrezorDispatchStatus } from "./connectAdapter";
import {
  buildTrezorDerivationPage,
  type TrezorDerivationScheme,
} from "./derivation";
import { normalizeTrezorError, TrezorError, TrezorErrorCode } from "./errors";
import {
  TREZOR_STATUS_SOURCE,
  type TrezorTransaction,
  type TrezorSignerStatus,
} from "./types";

const DISCOVERY_TIMEOUT_MS = 90_000;
const SIGNING_TIMEOUT_MS = 10 * 60_000;

type Adapter = typeof trezorConnectAdapter;

/** A cancelled upstream call keeps its slot until it settles; late results never escape. */
export function createTrezorConnectClient(
  adapter: Adapter,
  publish: (
    opId: string,
    status: TrezorSignerStatus,
    errorCode?: string,
  ) => void,
  timeouts = { discovery: DISCOVERY_TIMEOUT_MS, signing: SIGNING_TIMEOUT_MS },
) {
  let active: {
    opId: string;
    operation: ConnectOperation;
    abort: AbortController;
  } | null = null;

  async function run<T>(
    opId: string,
    signing: boolean,
    action: (
      dispatch: TrezorDispatchStatus,
      operation: ConnectOperation,
    ) => Promise<T>,
  ): Promise<T> {
    if (typeof opId !== "string" || !opId.trim() || opId.length > 128)
      throw new TrezorError(
        TrezorErrorCode.INVALID_RESPONSE,
        "Missing Trezor operation ID.",
      );
    if (active)
      throw new TrezorError(
        TrezorErrorCode.TRANSPORT_BUSY,
        "Another Trezor operation is still in progress. Finish or close its approval in Trezor Suite.",
      );
    const abort = new AbortController();
    const operation = { callId: crypto.randomUUID(), signal: abort.signal };
    const current = { opId, operation, abort };
    active = current;
    let timer: ReturnType<typeof setTimeout>;
    const cancelled = new Promise<never>((_, reject) => {
      abort.signal.addEventListener(
        "abort",
        () => {
          try {
            adapter.cancel(operation);
          } catch {
            /* Never let cancellation release an active upstream slot. */
          }
          reject(abort.signal.reason);
        },
        { once: true },
      );
      timer = setTimeout(
        () =>
          abort.abort(
            new TrezorError(
              TrezorErrorCode.TIMEOUT,
              "The Trezor request timed out. Finish or close its approval in Trezor Suite.",
            ),
          ),
        signing ? timeouts.signing : timeouts.discovery,
      );
    });
    const dispatch: TrezorDispatchStatus = (status) => {
      if (active === current && !abort.signal.aborted) publish(opId, status);
    };
    const work = Promise.resolve()
      .then(() => action(dispatch, operation))
      .then((result) => {
        if (abort.signal.aborted) throw abort.signal.reason;
        return result;
      })
      .finally(() => {
        clearTimeout(timer);
        if (active === current) active = null;
      });
    try {
      return await Promise.race([work, cancelled]);
    } catch (error) {
      const normalized = normalizeTrezorError(error);
      publish(opId, "error", normalized.code);
      throw normalized;
    }
  }

  return {
    connectTrezor: (opId: string) =>
      run(opId, false, (dispatch, operation) =>
        adapter.connectTrezor(dispatch, operation),
      ),
    scanTrezorAddresses: (input: {
      opId: string;
      deviceId: string;
      startIndex: number;
      count: number;
      scheme: TrezorDerivationScheme;
    }) =>
      run(input.opId, false, (dispatch, operation) =>
        adapter.scanTrezorAddresses(
          input.deviceId,
          buildTrezorDerivationPage(input),
          dispatch,
          operation,
        ),
      ),
    signTrezorTransaction: (input: {
      opId: string;
      deviceId: string;
      hdPath: string;
      transaction: TrezorTransaction;
    }) =>
      run(input.opId, true, (dispatch, operation) =>
        adapter.signTrezorTransaction(
          input.deviceId,
          input.hdPath,
          input.transaction,
          dispatch,
          operation,
        ),
      ),
    signTrezorMessage: (input: {
      opId: string;
      deviceId: string;
      hdPath: string;
      message: string;
    }) =>
      run(input.opId, true, (dispatch, operation) =>
        adapter.signTrezorMessage(
          input.deviceId,
          input.hdPath,
          input.message,
          dispatch,
          operation,
        ),
      ),
    signTrezorTypedData: (input: {
      opId: string;
      deviceId: string;
      hdPath: string;
      typedData: Record<string, unknown>;
      domainSeparatorHash?: string;
      messageHash?: string;
    }) =>
      run(input.opId, true, (dispatch, operation) =>
        adapter.signTrezorTypedData(
          input.deviceId,
          input.hdPath,
          input.typedData,
          input.domainSeparatorHash,
          input.messageHash,
          dispatch,
          operation,
        ),
      ),
    cancelTrezorOperation: async (opId: string): Promise<boolean> => {
      if (active?.opId !== opId) return false;
      active.abort.abort(
        new TrezorError(
          TrezorErrorCode.USER_REJECTED,
          "The Trezor request was cancelled.",
        ),
      );
      return true;
    },
  };
}

const client = createTrezorConnectClient(
  trezorConnectAdapter,
  (opId, status, errorCode) => {
    void chrome.runtime
      .sendMessage({
        type: "trezorStatus",
        source: TREZOR_STATUS_SOURCE,
        opId,
        status,
        ...(errorCode ? { errorCode } : {}),
      })
      .catch(() => undefined);
  },
);
export const {
  connectTrezor,
  scanTrezorAddresses,
  signTrezorTransaction,
  signTrezorMessage,
  signTrezorTypedData,
  cancelTrezorOperation,
} = client;
