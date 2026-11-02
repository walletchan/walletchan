/** A fetch stub that routes relay POSTs into a FakeLattice, for background-domain tests. */
import { bytesToHex } from "viem";
import type { FakeLattice } from "./fakeLattice";

export interface RelayFetchStub {
  urls: string[];
  /** Holds the next request until release() is called. */
  hold(): { release(): void };
  restore(): void;
}

export function installRelayFetch(devices: Record<string, FakeLattice>): RelayFetchStub {
  const original = globalThis.fetch;
  const urls: string[] = [];
  let gate: Promise<void> | null = null;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    urls.push(String(url));
    if (gate) {
      const waiting = gate;
      gate = null;
      await new Promise<void>((resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        void waiting.then(resolve);
      });
    }
    const deviceId = String(url).split("/").pop() as string;
    const device = devices[deviceId];
    if (!device) return new Response("<html>504</html>", { status: 504 });
    const body = JSON.parse(String(init.body)) as { data: { data: number[] } };
    const reply = await device.send(Uint8Array.from(body.data.data));
    return new Response(JSON.stringify({ status: 200, message: bytesToHex(reply).slice(2) }), { status: 200 });
  }) as typeof fetch;
  return {
    urls,
    hold() {
      let release = () => undefined as void;
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return { release };
    },
    restore() {
      globalThis.fetch = original;
    },
  };
}
