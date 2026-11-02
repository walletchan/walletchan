/**
 * HTTPS transport to a Lattice relay (GridPlus cloud or self-hosted Lattice Connect).
 *
 * Ported from ape-grid-lattice `ape_grid/protocol/transport.py`, which mirrors
 * gridplus-sdk `api/rest.ts`:
 *
 *   POST {baseUrl}/{deviceId}
 *   Body:     {"data": {"type": "Buffer", "data": [...frame bytes]}}
 *   Response: {"status": 200, "message": "<hex response frame>"}
 */
import { hexToBytes, isHex } from "viem";
import { LatticeTransportError } from "./errors";

export interface LatticeTransport {
  send(frame: Uint8Array, signal?: AbortSignal): Promise<Uint8Array>;
}

export const LATTICE_DEFAULT_TIMEOUT_MS = 60_000;

const DEVICE_ID_RE = /^[A-Za-z0-9]{1,32}$/;

export function isValidLatticeDeviceId(deviceId: string): boolean {
  return DEVICE_ID_RE.test(deviceId);
}

/** Accepts https URLs and plain-http local relays; strips a trailing slash. */
export function normalizeLatticeRelayUrl(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new LatticeTransportError("Invalid Lattice connection endpoint.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new LatticeTransportError("Invalid Lattice connection endpoint.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new LatticeTransportError("Invalid Lattice connection endpoint.");
  }
  return url.toString().replace(/\/+$/, "");
}

function hexToFrame(message: unknown): Uint8Array {
  const hex = typeof message === "string" ? (message.startsWith("0x") ? message : `0x${message}`) : "";
  if (hex.length < 4 || hex.length % 2 !== 0 || !isHex(hex)) {
    throw new LatticeTransportError("Lattice relay returned a non-hex message.");
  }
  return hexToBytes(hex);
}

export function createLatticeRelayTransport(input: {
  deviceId: string;
  baseUrl: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): LatticeTransport {
  if (!isValidLatticeDeviceId(input.deviceId)) {
    throw new LatticeTransportError("Lattice device ID must be alphanumeric.");
  }
  const url = `${normalizeLatticeRelayUrl(input.baseUrl)}/${input.deviceId}`;
  const timeoutMs = input.timeoutMs ?? LATTICE_DEFAULT_TIMEOUT_MS;
  const fetchImpl = input.fetchImpl ?? fetch;

  return {
    async send(frame, signal) {
      if (signal?.aborted) throw new LatticeTransportError("Lattice request was cancelled.");
      // Manual signal merge: AbortSignal.any needs Firefox 124, WalletChan allows 121.
      const controller = new AbortController();
      let timedOut = false;
      const onAbort = () => controller.abort();
      signal?.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: { type: "Buffer", data: Array.from(frame) } }),
          signal: controller.signal,
          credentials: "omit",
          referrerPolicy: "no-referrer",
        });
      } catch (err) {
        if (signal?.aborted) throw new LatticeTransportError("Lattice request was cancelled.");
        if (timedOut) throw new LatticeTransportError("Lattice relay timed out.");
        throw new LatticeTransportError(`Lattice relay request failed: ${(err as Error).message}`);
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new LatticeTransportError(`Lattice relay returned non-JSON (HTTP ${response.status}).`);
      }
      if (!body || typeof body !== "object" || !("message" in body)) {
        throw new LatticeTransportError("Lattice relay returned an invalid body.");
      }
      const { status, message } = body as { status?: unknown; message?: unknown };
      if (status !== 200) {
        const detail = typeof message === "string" ? message.slice(0, 200) : "";
        throw new LatticeTransportError(`Lattice relay error ${String(status)}: ${detail}`);
      }
      return hexToFrame(message);
    },
  };
}
