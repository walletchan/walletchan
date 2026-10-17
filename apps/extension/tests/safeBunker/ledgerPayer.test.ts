import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseTransaction, keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createServer } from "vite";

test("Bunker Ledger preflight runs after device approval and blocks release on changes", async () => {
  const signer = privateKeyToAccount(`0x${"11".repeat(32)}`);
  const account = { id: "ledger", type: "ledger", address: signer.address.toLowerCase(), deviceId: "device", hdPath: "m/44'/60'/0'/0/0" };
  const state = { account: { ...account }, events: [] as string[], changed: false, locked: false, resets: 0,
    sign: async (raw: `0x${string}`) => {
      state.events.push("device approval");
      assert.equal(state.locked, false);
      const signed = parseTransaction(await signer.signTransaction(parseTransaction(raw) as never));
      return { r: signed.r, s: signed.s, v: Number(signed.yParity) };
    } };
  Object.assign(globalThis, { __bunkerLedgerQa: state });
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const server = await createServer({ root, configFile: false, server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true }, resolve: { alias: { "@": path.join(root, "src") } },
    plugins: [{ name: "bunker-ledger-device-boundary", enforce: "pre",
      resolveId(source, importer) {
        const file = importer?.split("?", 1)[0] ?? "";
        if (file.endsWith("/ledger/signing.ts") && source === "./offscreenBridge") return "\0bunker-device";
        if (file.endsWith("/safeBunker/payer.ts")) return ({ "../accountStorage": "\0bunker-account", "../accounts/localKeyResolver": "\0bunker-key",
          "../storageLock": "\0bunker-lock", "../ledger/session": "\0bunker-session", "../forceInclusion/nonceManager": "\0bunker-nonce" } as Record<string, string>)[source];
      },
      load(id) {
        const s = "const s = globalThis.__bunkerLedgerQa;";
        if (id === "\0bunker-account") return s + "export const getAccountById = async () => s.account;";
        if (id === "\0bunker-key") return "export const getLocalPrivateKeyForAccount = async () => { throw Error('Hardware keys must never be read'); };";
        if (id === "\0bunker-lock") return s + "export const WALLET_SECRET_OPERATION_LOCK_KEY = 'wallet'; export const withStorageLock = async (key, work) => { s.locked = true; try { return await work(); } finally { s.locked = false; } };";
        if (id === "\0bunker-session") return "export const ensureLedgerSigningSession = async () => 'master';";
        if (id === "\0bunker-nonce") return s + "export const getNextNonce = async () => 7; export const resetNonce = () => { s.resets++; };";
        if (id === "\0bunker-device") return s + "export const signLedgerTransaction = async input => s.sign(input.unsignedTx); export const signLedgerMessage = async () => { throw Error('unexpected'); }; export const signLedgerTypedData = signLedgerMessage;";
      },
    }],
  });
  const beforeFetch = globalThis.fetch;
  globalThis.fetch = (async (_input, init) => {
    const request = JSON.parse(init!.body as string);
    assert.equal(request.method, "eth_sendRawTransaction");
    state.events.push("broadcast"); assert.equal(state.locked, true);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: keccak256(request.params[0]) }));
  }) as typeof fetch;
  try {
    const { submitBunkerOuter } = await server.ssrLoadModule("/src/chrome/safeBunker/payer.ts");
    const input = { id: "request", payerId: account.id, payerAddress: account.address, to: signer.address, data: "0x", rpc: "https://fixture.example", gas: { gasLimit: "100000", maxFeePerGas: "10", maxPriorityFeePerGas: "1" },
      current: () => { if (state.changed) throw Error("Authentication changed"); },
      beforeBroadcast: async () => { state.events.push("final preflight and durable save"); assert.equal(state.locked, true); assert.ok(state.events.includes("device approval")); if (state.changed) throw Error("Safe owner changed during device approval"); } };
    await submitBunkerOuter(input);
    assert.deepEqual(state.events, ["device approval", "final preflight and durable save", "broadcast"]);
    state.events = []; state.changed = true;
    await assert.rejects(submitBunkerOuter({ ...input, current: () => {}, beforeBroadcast: async () => { state.events.push("final preflight"); throw Error("Safe owner changed during device approval"); } }), /Safe owner changed/);
    assert.deepEqual(state.events, ["device approval", "final preflight"]);
    assert.equal(state.resets, 1);
    state.changed = false;
    state.account = { ...account, type: "bankr" } as typeof account;
    await assert.rejects(submitBunkerOuter(input), /Choose a private-key/);
  } finally { globalThis.fetch = beforeFetch; await server.close(); delete (globalThis as any).__bunkerLedgerQa; }
});
