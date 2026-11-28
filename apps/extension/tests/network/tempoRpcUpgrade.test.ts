import assert from "node:assert/strict";
import test from "node:test";
import { getStoredRpcUrl, normalizeNetworksInfo } from "../../src/lib/chains";
import { ensureNetworksInfo } from "../../src/chrome/network/networkMutations";

const replacement = "https://rpc.tempo.xyz";

test("old Tempo defaults upgrade on reads and persist once without changing other settings", async () => {
  const state: Record<string, any> = { chainName: "My Tempo", autoLockTimeout: 15, networksInfo: {
    "My Tempo": { chainId: 4217, rpcUrl: "https://rpc.presto.tempo.xyz/", hidden: false },
    Ethereum: { chainId: 1, rpcUrl: "https://my-ethereum.example/rpc", hidden: true },
  } };
  const writes: unknown[] = [], before = globalThis.chrome;
  globalThis.chrome = { storage: { sync: {
    get: async (keys: string | string[]) => Object.fromEntries((typeof keys === "string" ? [keys] : keys).map((key) => [key, state[key]])),
    set: async (update: Record<string, unknown>) => { writes.push(structuredClone(update)); Object.assign(state, update); },
  } } } as unknown as typeof chrome;
  try {
    assert.equal(await getStoredRpcUrl(4217), replacement, "background reads work before UI migration");
    assert.equal(writes.length, 0);
    assert.equal((await ensureNetworksInfo()).success, true);
    assert.equal(state.networksInfo["Tempo"].rpcUrl, replacement);
    assert.equal(state.networksInfo["Tempo"].hidden, false);
    assert.equal(state.networksInfo.Ethereum.rpcUrl, "https://my-ethereum.example/rpc");
    assert.equal(state.networksInfo.Ethereum.hidden, true);
    assert.equal(state.chainName, "Tempo");
    assert.equal(state.autoLockTimeout, 15);
    assert.equal(writes.length, 1);
    await ensureNetworksInfo();
    assert.equal(writes.length, 1, "normalization is idempotent");
  } finally { globalThis.chrome = before; }
});

test("custom Tempo endpoints and similarly named hosts are never replaced", () => {
  for (const rpcUrl of ["http://127.0.0.1:8545", "https://custom.example/rpc", "https://rpc.presto.tempo.xyz/custom", "https://rpc.presto.tempo.xyz/?key=example", "https://rpc.presto.tempo.xyz.example/rpc"]) {
    const normalized = normalizeNetworksInfo({ "Tempo": { chainId: 4217, rpcUrl, hidden: true } });
    assert.equal(normalized["Tempo"].rpcUrl, rpcUrl);
    assert.equal(normalized["Tempo"].hidden, true);
  }
});

test("fresh Tempo settings use the verified replacement and preserve the visible default", () => {
  const normalized = normalizeNetworksInfo(undefined);
  assert.equal(normalized["Tempo"].rpcUrl, replacement);
  assert.equal(normalized["Tempo"].hidden ?? false, false);
});
