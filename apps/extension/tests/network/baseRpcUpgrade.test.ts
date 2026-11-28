import assert from "node:assert/strict";
import test from "node:test";
import { getStoredRpcUrl, normalizeNetworksInfo } from "../../src/lib/chains";
import { ensureNetworksInfo } from "../../src/chrome/network/networkMutations";

const replacement = "https://mainnet.base.org";

test("old Base defaults upgrade on reads and persist once without changing other settings", async () => {
  const state: Record<string, any> = { chainName: "My Base", autoLockTimeout: 15, networksInfo: {
    "My Base": { chainId: 8453, rpcUrl: "https://base.drpc.org/", hidden: false },
    Ethereum: { chainId: 1, rpcUrl: "https://my-ethereum.example/rpc", hidden: true },
  } };
  const writes: unknown[] = [], before = globalThis.chrome;
  globalThis.chrome = { storage: { sync: {
    get: async (keys: string | string[]) => Object.fromEntries((typeof keys === "string" ? [keys] : keys).map((key) => [key, state[key]])),
    set: async (update: Record<string, unknown>) => { writes.push(structuredClone(update)); Object.assign(state, update); },
  } } } as unknown as typeof chrome;
  try {
    assert.equal(await getStoredRpcUrl(8453), replacement, "background reads work before UI migration");
    assert.equal(writes.length, 0);
    assert.equal((await ensureNetworksInfo()).success, true);
    assert.equal(state.networksInfo["Base"].rpcUrl, replacement);
    assert.equal(state.networksInfo["Base"].hidden, false);
    assert.equal(state.networksInfo.Ethereum.rpcUrl, "https://my-ethereum.example/rpc");
    assert.equal(state.networksInfo.Ethereum.hidden, true);
    assert.equal(state.chainName, "Base");
    assert.equal(state.autoLockTimeout, 15);
    assert.equal(writes.length, 1);
    await ensureNetworksInfo();
    assert.equal(writes.length, 1, "normalization is idempotent");
  } finally { globalThis.chrome = before; }
});

test("custom Base endpoints and similarly named hosts are never replaced", () => {
  for (const rpcUrl of ["http://127.0.0.1:8545", "https://custom.example/rpc", "https://base.drpc.org/custom", "https://base.drpc.org/?key=example", "https://base.drpc.org.example/rpc"]) {
    const normalized = normalizeNetworksInfo({ "Base": { chainId: 8453, rpcUrl, hidden: true } });
    assert.equal(normalized["Base"].rpcUrl, rpcUrl);
    assert.equal(normalized["Base"].hidden, true);
  }
});

test("fresh Base settings use the verified replacement and preserve the visible default", () => {
  const normalized = normalizeNetworksInfo(undefined);
  assert.equal(normalized["Base"].rpcUrl, replacement);
  assert.equal(normalized["Base"].hidden ?? false, false);
});
