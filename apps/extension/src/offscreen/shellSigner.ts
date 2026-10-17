import ShellJS from "@choppu/shelljs";
import TransportWebHID from "@choppu/shelljs-web-hid";
import { getTypesForEIP712Domain } from "viem";
import { publicKeyToAddress } from "viem/accounts";
import { keycardShellMessage, LedgerError, LedgerErrorCode, normalizeLedgerError, statusCode } from "../chrome/ledger/errors";
import { withoutMasterPrefix } from "../lib/bip32Path";
import { pathForScheme, type DispatchStatus, type HdPathScheme } from "./ledgerSigner";

// Keycard Shell over WebHID. Same surface and device-identity rule as ledgerSigner:
// deviceId is the lowercase address at m/44'/60'/0'/0/0, revalidated every session.
type Signature = { r: `0x${string}`; s: `0x${string}`; v: number };
type Commands = InstanceType<typeof ShellJS.Commands>;

export const KEYCARD_SHELL_MODEL = "keycardShell";
const CANONICAL_PATH = "m/44'/60'/0'/0/0";
const ACTION_TIMEOUT_MS = 10 * 60_000;
const RELEASE_WAIT_MS = 5_000;
const SHELL_PRODUCT_ID = 0x21f7;
// Buffer.from(hex) silently truncates bad input, so the device would sign different bytes.
const WELL_FORMED_HEX = /^0x(?:[0-9a-f]{2})+$/i;
let activeCancel: (() => void) | null = null;

export async function connectShell(dispatch: DispatchStatus): Promise<{
  deviceId: string; deviceLabel: string; deviceModel: string;
}> {
  return withSession(null, dispatch, async (cmd, dispatch) => {
    dispatch("awaiting-app");
    const address = await getAddress(cmd, CANONICAL_PATH);
    dispatch("success");
    return { deviceId: address.toLowerCase(), deviceLabel: "Keycard Shell", deviceModel: KEYCARD_SHELL_MODEL };
  });
}

export async function scanAddresses(
  deviceId: string,
  startIndex: number,
  count: number,
  scheme: HdPathScheme,
  customTemplate: string | undefined,
  dispatch: DispatchStatus,
): Promise<Array<{ hdPath: string; hdIndex: number; address: `0x${string}` }>> {
  if (!Number.isSafeInteger(startIndex) || startIndex < 0 || count < 1 || count > 20) {
    throw new Error("Invalid Keycard Shell scan range.");
  }
  return withSession(deviceId, dispatch, async (cmd, dispatch) => {
    dispatch("scanning");
    const addresses = [];
    for (let index = startIndex; index < startIndex + count; index += 1) {
      const hdPath = pathForScheme(scheme, index, customTemplate);
      addresses.push({ hdPath, hdIndex: index, address: await getAddress(cmd, hdPath) });
    }
    dispatch("success");
    return addresses;
  });
}

export async function signTransaction(
  deviceId: string, hdPath: string, unsignedTx: `0x${string}`, dispatch: DispatchStatus,
): Promise<Signature> {
  if (!WELL_FORMED_HEX.test(unsignedTx)) {
    throw new LedgerError(LedgerErrorCode.UNKNOWN, "Keycard Shell can only sign a well-formed transaction.");
  }
  return withSession(deviceId, dispatch, async (cmd, dispatch) => {
    dispatch("awaiting-confirmation");
    const output = await cmd.signEthTransaction(withoutMasterPrefix(hdPath), unsignedTx.slice(2));
    const signature = toSignature({ ...output, v: Number.parseInt(output.v, 16) });
    dispatch("success");
    // shortcut: v follows ShellJS's truncated-chainId convention; the background
    // treats it as a hint and accepts only the parity that recovers to the pinned account.
    return signature;
  });
}

export async function signMessage(
  deviceId: string, hdPath: string, hex: `0x${string}`, dispatch: DispatchStatus,
): Promise<Signature> {
  if (!WELL_FORMED_HEX.test(hex)) {
    throw new LedgerError(LedgerErrorCode.UNKNOWN, "Keycard Shell can only sign a non-empty, well-formed message.");
  }
  return withSession(deviceId, dispatch, async (cmd, dispatch) => {
    dispatch("awaiting-confirmation");
    const signature = toSignature(await cmd.signEthPersonalMessage(withoutMasterPrefix(hdPath), hex.slice(2), "hex"));
    dispatch("success");
    return signature;
  });
}

export async function signTypedData(
  deviceId: string,
  hdPath: string,
  typedData: { domain: Record<string, unknown>; types: Record<string, Array<{ name: string; type: string }>>; primaryType: string; message: Record<string, unknown> },
  dispatch: DispatchStatus,
): Promise<Signature> {
  return withSession(deviceId, dispatch, async (cmd, dispatch) => {
    dispatch("awaiting-confirmation");
    // The Shell hashes the JSON itself and needs the domain type spelled out.
    const types = typedData.types.EIP712Domain
      ? typedData.types
      : { EIP712Domain: getTypesForEIP712Domain({ domain: typedData.domain as never }), ...typedData.types };
    const signature = toSignature(await cmd.signEIP712Message(withoutMasterPrefix(hdPath), { ...typedData, types }));
    dispatch("success");
    return signature;
  });
}

export function cancelActiveOperation(): void {
  activeCancel?.();
}

/** expectedDeviceId null means connect: use the first Shell that opens, with no identity check. */
async function withSession<T>(
  expectedDeviceId: string | null,
  dispatch: DispatchStatus,
  run: (cmd: Commands, dispatch: DispatchStatus) => Promise<T>,
): Promise<T> {
  if (expectedDeviceId !== null && (typeof expectedDeviceId !== "string" || !expectedDeviceId)) {
    throw new LedgerError(LedgerErrorCode.UNKNOWN, "Missing Keycard Shell device identity.");
  }
  if (activeCancel) {
    throw new LedgerError(LedgerErrorCode.TRANSPORT_BUSY, "Another Keycard Shell operation is in progress.");
  }
  let settled = false;
  const opened: TransportWebHID[] = [];
  const opening: Promise<unknown>[] = [];
  // An open still in flight at settle is closed when it lands, and the session waits for that too.
  const track = (pending: Promise<TransportWebHID>) => {
    const step = pending.then(async (transport) => {
      if (!settled) {
        opened.push(transport);
        return transport;
      }
      await release(transport);
      throw new LedgerError(LedgerErrorCode.USER_REJECTED, "Keycard Shell operation ended.");
    });
    opening.push(step);
    return step;
  };
  // A cancelled or timed-out call may still be pending on the device; drop its late status updates.
  const guarded: DispatchStatus = (status, extra) => { if (!settled) dispatch(status, extra); };
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await new Promise<T>((resolve, reject) => {
      const finish = (complete: () => void) => {
        if (settled) return;
        settled = true;
        // Settle only once every handle is closed, so the next operation cannot reopen one mid-close.
        // shortcut: a hung open/close is abandoned after RELEASE_WAIT_MS rather than locking the signer forever.
        void Promise.race([
          Promise.allSettled([...opened.splice(0).map(release), ...opening]),
          new Promise((resolve) => setTimeout(resolve, RELEASE_WAIT_MS)),
        ]).then(complete);
      };
      activeCancel = () => finish(() => reject(
        new LedgerError(LedgerErrorCode.USER_REJECTED, "Keycard Shell operation cancelled."),
      ));
      timer = setTimeout(() => finish(() => reject(new LedgerError(
        LedgerErrorCode.DEVICE_DISCONNECTED,
        "Keycard Shell did not respond. Reconnect it and try again.",
      ))), ACTION_TIMEOUT_MS);
      guarded("connecting");
      acquire(expectedDeviceId, track, () => settled)
        .then((cmd) => {
          if (settled) throw new LedgerError(LedgerErrorCode.USER_REJECTED, "Keycard Shell operation ended.");
          return run(cmd, guarded);
        })
        .then((value) => finish(() => resolve(value)), (error) => finish(() => reject(error)));
    });
  } catch (error) {
    throw shellError(error);
  } finally {
    activeCancel = null;
    if (timer) clearTimeout(timer);
  }
}

/** Opens the granted Shell whose canonical address matches, skipping devices that fail the probe. */
async function acquire(
  expectedDeviceId: string | null,
  track: (pending: Promise<TransportWebHID>) => Promise<TransportWebHID>,
  isSettled: () => boolean,
): Promise<Commands> {
  // Only devices the user already granted from the setup tab; the offscreen page cannot prompt.
  // list() filters by the shared pid.codes vendor ID only, so also require the Shell product ID.
  const devices = (await TransportWebHID.list()).filter((device) => device.productId === SHELL_PRODUCT_ID);
  if (!devices.length) {
    throw new LedgerError(LedgerErrorCode.PERMISSION_DENIED, "Plug in your Keycard Shell, unlock it, and try again.");
  }
  let lastError: unknown = null;
  for (const device of devices) {
    // A cancelled or timed-out session must not open any further device.
    if (isSettled()) break;
    let transport: TransportWebHID | null = null;
    try {
      transport = await track(TransportWebHID.open(device));
      const cmd = new ShellJS.Commands(transport);
      if (expectedDeviceId === null) return cmd;
      const identity = await getAddress(cmd, CANONICAL_PATH);
      if (identity.toLowerCase() === expectedDeviceId.toLowerCase()) return cmd;
    } catch (error) {
      lastError = error;
    }
    // After settle the session already closed it, and the device may now belong to a newer operation.
    if (transport && !isSettled()) await release(transport);
  }
  if (lastError) throw lastError;
  throw new LedgerError(LedgerErrorCode.DEVICE_DISCONNECTED, "Connect the Keycard Shell used by this account and try again.");
}

// TransportWebHID.close() first awaits any in-flight exchange, which never settles while the
// device waits for the user. Close the HID handle directly so cancel and timeout free it now.
async function release(transport: TransportWebHID): Promise<void> {
  transport.device.removeEventListener("inputreport", transport.onInputReport);
  if (!transport.device.opened) return;
  await transport.device.close().catch((error: unknown) => console.warn("[keycardShell] Failed to close device:", error));
}

// Shell status words (keycard-shell docs/USB.md); they differ from Ledger's.
const SHELL_STATUS: Record<number, [LedgerErrorCode, string]> = {
  0x6982: [LedgerErrorCode.USER_REJECTED, "Rejected on your Keycard Shell."],
  0x6985: [LedgerErrorCode.UNKNOWN, "Your Keycard Shell is not ready for this. Unlock it and try again."],
  0x6a80: [LedgerErrorCode.UNKNOWN, "Your Keycard Shell could not read this request."],
  0x6501: [LedgerErrorCode.FIRMWARE_TOO_OLD, "Your Keycard Shell does not support this. Update its firmware."],
  0x6d00: [LedgerErrorCode.FIRMWARE_TOO_OLD, "Update your Keycard Shell firmware."],
  0x6e00: [LedgerErrorCode.UNKNOWN, "Your Keycard Shell did not recognize this request."],
};
const SHELL_INTERNAL_ERROR: [LedgerErrorCode, string] = [
  LedgerErrorCode.UNKNOWN, "Your Keycard Shell hit an internal error. Restart it and try again.",
];

export function shellError(error: unknown): LedgerError {
  const normalized = normalizeLedgerError(error);
  const status = error instanceof LedgerError ? null : statusCode(error);
  const mapped = status === null ? undefined : SHELL_STATUS[status] ?? (status >> 8 === 0x6f ? SHELL_INTERNAL_ERROR : undefined);
  if (mapped) return new LedgerError(mapped[0], mapped[1], normalized.technicalMessage);
  // No Shell status word: keep the shared transport fallbacks (disconnect, busy, permission), re-labelled.
  return new LedgerError(normalized.code, keycardShellMessage(normalized.userMessage), normalized.technicalMessage);
}

async function getAddress(cmd: Commands, path: string): Promise<`0x${string}`> {
  const { publicKey } = await cmd.getPublicKey(withoutMasterPrefix(path));
  if (!/^04[0-9a-f]{128}$/i.test(publicKey)) {
    throw new LedgerError(LedgerErrorCode.UNKNOWN, "Keycard Shell returned an unexpected public key.");
  }
  return publicKeyToAddress(`0x${publicKey}`) as `0x${string}`;
}

function toSignature(output: { r: string; s: string; v: number }): Signature {
  if (!/^[0-9a-f]{64}$/i.test(output.r) || !/^[0-9a-f]{64}$/i.test(output.s) || !Number.isSafeInteger(output.v)) {
    throw new LedgerError(LedgerErrorCode.UNKNOWN, "Keycard Shell returned a malformed signature.");
  }
  return { r: `0x${output.r}` as const, s: `0x${output.s}` as const, v: output.v };
}
