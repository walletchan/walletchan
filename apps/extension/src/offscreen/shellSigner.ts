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
// Non-empty too: ShellJS 1.0.1 sendChunks sends no APDU for zero bytes, then reads an undefined response.
const WELL_FORMED_HEX = /^0x(?:[0-9a-f]{2})+$/i;
let activeCancel: (() => void) | null = null;
// Handles of an ended session still closing after RELEASE_WAIT_MS; no new session may open until they land.
let releasing: { done: Promise<unknown>; devices: Set<unknown> } | null = null;
// An open or close that never settles would block forever; unplugging a device that session opened
// ends that wait. Another Shell's disconnect does not, since the stuck handle would still be open.
(globalThis.navigator as { hid?: EventTarget } | undefined)?.hid?.addEventListener("disconnect", (event) => {
  if (releasing?.devices.has((event as Event & { device: unknown }).device)) releasing = null;
});

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
  if (hex === "0x") {
    throw new LedgerError(LedgerErrorCode.UNKNOWN, "Keycard Shell cannot sign an empty message.");
  }
  if (!WELL_FORMED_HEX.test(hex)) {
    throw new LedgerError(LedgerErrorCode.UNKNOWN, "Keycard Shell can only sign a well-formed message.");
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

/** expectedDeviceId null means connect: bind to the one wallet every plugged-in Shell entry reports. */
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
  if (releasing) {
    throw new LedgerError(
      LedgerErrorCode.TRANSPORT_BUSY,
      "Keycard Shell is still closing the last operation. Unplug it, plug it back in, and try again.",
    );
  }
  let settled = false;
  const opened: TransportWebHID[] = [];
  const opening: Array<{ step: Promise<unknown>; device: unknown; landed: boolean }> = [];
  // An open still in flight at settle is closed when it lands, and the session waits for that too.
  const track = (pending: Promise<TransportWebHID>, device: unknown) => {
    const step = pending.then(async (transport) => {
      if (!settled) {
        opened.push(transport);
        return transport;
      }
      await release(transport);
      throw new LedgerError(LedgerErrorCode.USER_REJECTED, "Keycard Shell operation ended.");
    });
    const entry = { step, device, landed: false };
    void step.finally(() => { entry.landed = true; }).catch(() => undefined);
    opening.push(entry);
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
        // Settle once every handle is closed, or after RELEASE_WAIT_MS so the caller is not stuck.
        // A close still running then keeps the signer blocked until it lands.
        // Only devices whose handle is still closing (or still opening) may lift the lock on unplug.
        const devices = new Set<unknown>();
        // One close per device: a probe may have reopened it, and the latest handle is the live one.
        const latest = [...new Map(opened.splice(0).map((transport) => [transport.device, transport])).values()];
        const closes = latest.map((transport) => {
          devices.add(transport.device);
          return release(transport).finally(() => devices.delete(transport.device));
        });
        const lands = opening.filter((entry) => !entry.landed).map(({ step, device }) => {
          devices.add(device);
          return step.finally(() => devices.delete(device));
        });
        const cleanup = Promise.allSettled([...closes, ...lands]);
        const pending = { done: cleanup, devices };
        releasing = pending;
        void cleanup.then(() => { if (releasing === pending) releasing = null; });
        void Promise.race([cleanup, new Promise((resolve) => setTimeout(resolve, RELEASE_WAIT_MS))]).then(complete);
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
  track: (pending: Promise<TransportWebHID>, device: unknown) => Promise<TransportWebHID>,
  isSettled: () => boolean,
): Promise<Commands> {
  // Only devices the user already granted from the setup tab; the offscreen page cannot prompt.
  // list() filters by the shared pid.codes vendor ID only, so also require the Shell product ID.
  const devices = (await TransportWebHID.list()).filter((device) => device.productId === SHELL_PRODUCT_ID);
  if (!devices.length) {
    throw new LedgerError(LedgerErrorCode.PERMISSION_DENIED, "Plug in your Keycard Shell, unlock it, and try again.");
  }
  // The offscreen page cannot tell which Shell the chooser picked, so connect with several entries
  // (several Shells, or one Shell listed twice) proceeds only if every one reports the same wallet.
  if (expectedDeviceId === null && devices.length > 1) {
    const identities = new Set<string>();
    for (const device of devices) {
      if (isSettled()) break;
      const identity = await probe(device, track, isSettled, async (cmd) => getAddress(cmd, CANONICAL_PATH));
      if (identity) identities.add(identity.toLowerCase());
    }
    if (identities.size !== 1) {
      throw new LedgerError(LedgerErrorCode.UNKNOWN, "More than one Keycard Shell is plugged in. Leave only the one to add and try again.");
    }
    expectedDeviceId = [...identities][0];
  }
  let lastError: unknown = null;
  for (const device of devices) {
    // A cancelled or timed-out session must not open any further device.
    if (isSettled()) break;
    try {
      const cmd = await probe(device, track, isSettled, async (cmd) => {
        if (expectedDeviceId === null) return cmd;
        const identity = await getAddress(cmd, CANONICAL_PATH);
        return identity.toLowerCase() === expectedDeviceId.toLowerCase() ? cmd : null;
      }, true);
      if (cmd) return cmd;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  throw new LedgerError(LedgerErrorCode.DEVICE_DISCONNECTED, "Connect the Keycard Shell used by this account and try again.");
}

/** Opens one device and runs check; closes it again unless keep is set and check returned a value. */
async function probe<T>(
  device: Parameters<typeof TransportWebHID.open>[0],
  track: (pending: Promise<TransportWebHID>, device: unknown) => Promise<TransportWebHID>,
  isSettled: () => boolean,
  check: (cmd: Commands) => Promise<T | null>,
  keep = false,
): Promise<T | null> {
  let transport: TransportWebHID | null = null;
  let result: T | null = null;
  try {
    transport = await track(TransportWebHID.open(device), device);
    result = await check(new ShellJS.Commands(transport));
    return result;
  } finally {
    // After settle the session already closed it, and the device may now belong to a newer operation.
    if (transport && !(keep && result !== null) && !isSettled()) await release(transport);
  }
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
