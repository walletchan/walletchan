import assert from "node:assert/strict";
import test from "node:test";
import { getStoredRpcUrl, normalizeNetworksInfo } from "../../src/lib/chains";
import { ensureNetworksInfo } from "../../src/chrome/network/networkMutations";

const replacement = "https://ethereum-sepolia-rpc.publicnode.com";

test("old Sepolia defaults upgrade on reads and persist once without changing other settings", async () => {
  const state: Record<string, any> = { chainName: "My Sepolia", autoLockTimeout: 15, networksInfo: {
    "My Sepolia": { chainId: 11155111, rpcUrl: "https://sepolia.drpc.org/", hidden: false },
    Base: { chainId: 8453, rpcUrl: "https://my-base.example/rpc", hidden: true },
  } };
  const writes: unknown[] = [], before = globalThis.chrome;
  globalThis.chrome = { storage: { sync: {
    get: async (keys: string | string[]) => Object.fromEntries((typeof keys === "string" ? [keys] : keys).map((key) => [key, state[key]])),
    set: async (update: Record<string, unknown>) => { writes.push(structuredClone(update)); Object.assign(state, update); },
  } } } as unknown as typeof chrome;
  try {
    assert.equal(await getStoredRpcUrl(11155111), replacement, "background reads work before UI migration");
    assert.equal(writes.length, 0);
    assert.equal((await ensureNetworksInfo()).success, true);
    assert.equal(state.networksInfo["Ethereum Sepolia"].rpcUrl, replacement);
    assert.equal(state.networksInfo["Ethereum Sepolia"].hidden, false);
    assert.equal(state.networksInfo.Base.rpcUrl, "https://my-base.example/rpc");
    assert.equal(state.networksInfo.Base.hidden, true);
    assert.equal(state.chainName, "Ethereum Sepolia");
    assert.equal(state.autoLockTimeout, 15);
    assert.equal(writes.length, 1);
    await ensureNetworksInfo();
    assert.equal(writes.length, 1, "normalization is idempotent");
  } finally { globalThis.chrome = before; }
});

test("custom Sepolia endpoints and similarly named hosts are never replaced", () => {
  for (const rpcUrl of ["http://127.0.0.1:8545", "https://custom.example/rpc", "https://sepolia.drpc.org/custom", "https://sepolia.drpc.org/?key=example", "https://sepolia.drpc.org.example/rpc"]) {
    const normalized = normalizeNetworksInfo({ "Ethereum Sepolia": { chainId: 11155111, rpcUrl, hidden: true } });
    assert.equal(normalized["Ethereum Sepolia"].rpcUrl, rpcUrl);
    assert.equal(normalized["Ethereum Sepolia"].hidden, true);
  }
});

test("fresh Sepolia settings use the verified replacement and preserve the hidden default", () => {
  const normalized = normalizeNetworksInfo(undefined);
  assert.equal(normalized["Ethereum Sepolia"].rpcUrl, replacement);
  assert.equal(normalized["Ethereum Sepolia"].hidden, true);
});
