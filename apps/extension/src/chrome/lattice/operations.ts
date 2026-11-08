/**
 * Lattice device operations in the background worker.
 *
 * The Lattice speaks HTTPS through its relay, so no offscreen document is
 * needed. One device operation runs at a time. Every operation connects first:
 * the ephemeral session key lives only in memory and a Manifest V3 worker may
 * stop between operations.
 *
 * Setup keeps an in-memory session (pairing key, verified wallet identity and
 * the exact addresses the device returned). The account commit reads relay,
 * wallet and address facts only from this session, never from the renderer.
 */
import { bytesToHex, getAddress, isAddress } from "viem";
import { GRIDPLUS_LATTICE_RELAY_URL } from "@/constants/externalUrls";
import type { LatticeAccount } from "../types";
import {
  LatticeProtocolClient,
  createLatticeRelayTransport,
  formatLatticeFirmware,
  generateLatticeAppKey,
  isValidLatticeDeviceId,
  latticeSignerPath,
  normalizeLatticeRelayUrl,
  type LatticeConnectResult,
} from "./protocol";
import { LatticeError, LatticeErrorCode, NOT_PAIRED_MESSAGE, normalizeLatticeError } from "./errors";
import { loadLatticeAppKey, requireLatticeAppKey } from "./appKeyVault";
import { getLatticeDevices } from "./storage";
import {
  LATTICE_CANONICAL_PATH,
  latticeDerivationPath,
  type LatticeDerivationScheme,
} from "./derivation";

export type LatticeStatus = "connecting" | "awaiting-pairing" | "scanning" | "awaiting-confirmation";

const SETUP_TTL_MS = 15 * 60_000;
const SETUP_REQUEST_TIMEOUT_MS = 60_000;
const SIGNING_REQUEST_TIMEOUT_MS = 180_000;
const MAX_SCANNED_ADDRESSES = 200;

/** Advisory progress for the open setup or review screen; no listener is fine. */
export function emitLatticeStatus(opId: string, status: LatticeStatus): void {
  void chrome.runtime.sendMessage({ type: "latticeStatus", opId, status }).catch(() => undefined);
}

let active: { opId: string; controller: AbortController } | null = null;

async function runLatticeOperation<T>(opId: string, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  if (typeof opId !== "string" || opId.length === 0 || opId.length > 256) {
    throw new Error("Missing operation ID.");
  }
  if (active) {
    throw new LatticeError(LatticeErrorCode.DEVICE_BUSY, "Another Lattice request is in progress.");
  }
  const controller = new AbortController();
  active = { opId, controller };
  try {
    return await run(controller.signal);
  } catch (error) {
    throw normalizeLatticeError(error);
  } finally {
    if (active?.opId === opId) active = null;
  }
}

/** Cancels the active operation with this ID; a no-op for any other ID. */
export async function cancelLatticeOperation(opId: string): Promise<void> {
  if (active?.opId === opId) active.controller.abort();
}

function relayTransport(relayDeviceId: string, endpoint: string | null, timeoutMs: number) {
  return createLatticeRelayTransport({
    deviceId: relayDeviceId,
    baseUrl: endpoint ?? GRIDPLUS_LATTICE_RELAY_URL,
    timeoutMs,
  });
}

// ---------- setup ----------

interface SetupIdentity {
  deviceId: string;
  walletUid: string;
  walletKind: "internal" | "safecard";
}

interface SetupSession {
  relayDeviceId: string;
  endpoint: string | null;
  appKey: Uint8Array;
  appKeyIsNew: boolean;
  client: LatticeProtocolClient;
  createdAt: number;
  identity: SetupIdentity | null;
  /** lowercase address -> exact path/index the device returned. */
  scanned: Map<string, { hdPath: string; hdIndex: number }>;
}

let setup: SetupSession | null = null;

export interface LatticeSetupDevice {
  deviceId: string;
  deviceLabel: string;
  deviceModel: string;
  walletKind: "internal" | "safecard";
  firmware: string;
}

export type LatticeSetupConnectResult =
  | { needsPairing: true }
  | ({ needsPairing: false } & LatticeSetupDevice);

/** Device ID and endpoint checks; the relay transport enforces the same rules. */
export function normalizeRelayDeviceId(value: unknown): string {
  const id = typeof value === "string" ? value.trim() : "";
  if (!isValidLatticeDeviceId(id)) throw new LatticeError(LatticeErrorCode.NOT_CONFIGURED, "Enter your Lattice device ID.");
  return id;
}

export function normalizeEndpoint(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? normalizeLatticeRelayUrl(value.trim()) : null;
}

export async function connectLatticeForSetup(input: {
  opId: string;
  relayDeviceId: string;
  endpoint: string | null;
}): Promise<LatticeSetupConnectResult> {
  const relayDeviceId = normalizeRelayDeviceId(input.relayDeviceId);
  const endpoint = normalizeEndpoint(input.endpoint);
  return runLatticeOperation(input.opId, async (signal) => {
    setup = null;
    const stored = await loadLatticeAppKey();
    const appKey = stored ?? (await generateLatticeAppKey());
    const client = new LatticeProtocolClient({
      appKey,
      transport: relayTransport(relayDeviceId, endpoint, SETUP_REQUEST_TIMEOUT_MS),
    });
    emitLatticeStatus(input.opId, "connecting");
    const result = await client.connect(signal);
    const session: SetupSession = {
      relayDeviceId,
      endpoint,
      appKey,
      appKeyIsNew: stored === null,
      client,
      createdAt: Date.now(),
      identity: null,
      scanned: new Map(),
    };
    setup = session;
    if (!result.isPaired) {
      emitLatticeStatus(input.opId, "awaiting-pairing");
      return { needsPairing: true };
    }
    return { needsPairing: false, ...(await identify(input.opId, session, result, signal)) };
  });
}

export async function pairLatticeForSetup(input: { opId: string; pairingCode: unknown }): Promise<LatticeSetupDevice> {
  const code = typeof input.pairingCode === "string" ? input.pairingCode.trim().toUpperCase() : "";
  if (!/^[A-Z0-9]{4,16}$/.test(code)) {
    throw new LatticeError(LatticeErrorCode.PAIRING_FAILED, "Enter the pairing code shown on your Lattice.");
  }
  const session = requireSetup();
  return runLatticeOperation(input.opId, async (signal) => {
    const result = await session.client.pair(code, signal);
    return identify(input.opId, session, result, signal);
  });
}

async function identify(
  opId: string,
  session: SetupSession,
  result: LatticeConnectResult,
  signal: AbortSignal,
): Promise<LatticeSetupDevice> {
  if (!result.activeWalletUid || !result.walletUids) {
    throw new LatticeError(LatticeErrorCode.NOT_PAIRED, NOT_PAIRED_MESSAGE);
  }
  emitLatticeStatus(opId, "scanning");
  const canonical = await readAddress(session.client, LATTICE_CANONICAL_PATH, signal);
  const walletKind = result.walletUids.external.some((byte) => byte !== 0) ? "safecard" : "internal";
  session.identity = {
    deviceId: canonical.toLowerCase(),
    walletUid: bytesToHex(result.activeWalletUid),
    walletKind,
  };
  session.scanned.clear();
  return {
    deviceId: session.identity.deviceId,
    deviceLabel: `Lattice1 · ${session.relayDeviceId}${walletKind === "safecard" ? " · SafeCard" : ""}`,
    deviceModel: "Lattice1",
    walletKind,
    firmware: formatLatticeFirmware(result.firmware),
  };
}

async function readAddress(client: LatticeProtocolClient, hdPath: string, signal: AbortSignal): Promise<`0x${string}`> {
  const [value] = await client.getAddresses({ startPath: latticeSignerPath(hdPath), n: 1, signal });
  if (typeof value !== "string" || !isAddress(value)) {
    throw new LatticeError(LatticeErrorCode.UNKNOWN, "Invalid address from Lattice.");
  }
  return getAddress(value) as `0x${string}`;
}

function requireSetup(deviceId?: string): SetupSession {
  if (!setup || Date.now() - setup.createdAt > SETUP_TTL_MS) {
    setup = null;
    throw new LatticeError(LatticeErrorCode.SETUP_EXPIRED, "Lattice setup expired. Connect again.");
  }
  if (deviceId !== undefined && setup.identity?.deviceId !== deviceId.toLowerCase()) {
    throw new LatticeError(LatticeErrorCode.SETUP_EXPIRED, "Lattice setup changed. Connect again.");
  }
  return setup;
}

export async function scanLatticeAddresses(input: {
  opId: string;
  deviceId: string;
  startIndex: number;
  count: number;
  scheme: LatticeDerivationScheme;
}): Promise<Array<{ address: `0x${string}`; hdPath: string; hdIndex: number }>> {
  const session = requireSetup(input.deviceId);
  return runLatticeOperation(input.opId, async (signal) => {
    emitLatticeStatus(input.opId, "scanning");
    const rows: Array<{ address: `0x${string}`; hdPath: string; hdIndex: number }> = [];
    for (let i = 0; i < input.count; i += 1) {
      const hdIndex = input.startIndex + i;
      const hdPath = latticeDerivationPath(input.scheme, hdIndex);
      const address = await readAddress(session.client, hdPath, signal);
      if (session.scanned.size >= MAX_SCANNED_ADDRESSES) {
        throw new LatticeError(LatticeErrorCode.SETUP_EXPIRED, "Too many addresses scanned. Connect again.");
      }
      session.scanned.set(address.toLowerCase(), { hdPath, hdIndex });
      rows.push({ address, hdPath, hdIndex });
    }
    return rows;
  });
}

export interface LatticeSetupCommit {
  relayDeviceId: string;
  endpoint: string | null;
  walletUid: string;
  walletKind: "internal" | "safecard";
  appKey: Uint8Array;
  appKeyIsNew: boolean;
  /** Only addresses the device returned during this setup, with their exact paths. */
  resolveScanned(address: string): { hdPath: string; hdIndex: number } | null;
}

export function getLatticeSetupForCommit(deviceId: string): LatticeSetupCommit {
  const session = requireSetup(deviceId);
  const identity = session.identity as SetupIdentity;
  return {
    relayDeviceId: session.relayDeviceId,
    endpoint: session.endpoint,
    walletUid: identity.walletUid,
    walletKind: identity.walletKind,
    appKey: session.appKey,
    appKeyIsNew: session.appKeyIsNew,
    resolveScanned: (address) => session.scanned.get(address.toLowerCase()) ?? null,
  };
}

export function clearLatticeSetup(): void {
  setup = null;
}

// ---------- signing ----------

export interface LatticeSigningContext {
  client: LatticeProtocolClient;
  signerPath: number[];
  signal: AbortSignal;
}

/**
 * Connects to the account's Lattice, checks pairing and the pinned wallet
 * (internal or SafeCard), then runs one signing step.
 */
export async function withLatticeAccount<T>(
  input: { opId: string; account: LatticeAccount },
  run: (context: LatticeSigningContext) => Promise<T>,
): Promise<T> {
  return runLatticeOperation(input.opId, async (signal) => {
    const device = (await getLatticeDevices())[input.account.deviceId];
    if (!device) {
      throw new LatticeError(
        LatticeErrorCode.NOT_CONFIGURED,
        NOT_PAIRED_MESSAGE,
      );
    }
    const appKey = await requireLatticeAppKey();
    const client = new LatticeProtocolClient({
      appKey,
      transport: relayTransport(device.relayDeviceId, device.endpoint, SIGNING_REQUEST_TIMEOUT_MS),
    });
    emitLatticeStatus(input.opId, "connecting");
    const result = await client.connect(signal);
    if (!result.isPaired) {
      throw new LatticeError(
        LatticeErrorCode.NOT_PAIRED,
        NOT_PAIRED_MESSAGE,
      );
    }
    if (!result.activeWalletUid || bytesToHex(result.activeWalletUid) !== device.walletUid) {
      throw new LatticeError(
        LatticeErrorCode.WRONG_WALLET,
        device.walletKind === "safecard"
          ? "Insert this account's SafeCard."
          : "Remove the SafeCard from your Lattice.",
      );
    }
    emitLatticeStatus(input.opId, "awaiting-confirmation");
    return run({ client, signerPath: latticeSignerPath(input.account.hdPath), signal });
  });
}
