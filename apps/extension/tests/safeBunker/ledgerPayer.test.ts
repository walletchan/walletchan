import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseTransaction, keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createServer } from "vite";

for (const provider of ["ledger", "trezor"] as const) test(`Bunker ${provider} preflight runs after device approval and blocks release on changes`, async () => {
  const signer = privateKeyToAccount(`0x${"11".repeat(32)}`);
  const account = { id: provider, type: provider, address: signer.address.toLowerCase(), deviceId: signer.address.toLowerCase(), hdPath: "m/44'/60'/0'/0/0", hdIndex: 0, createdAt: 1 };
  const state = { account: { ...account }, events: [] as string[], changed: false, locked: false, resets: 0, onApproval: () => {},
    sign: async (raw: `0x${string}`) => {
      state.events.push("device approval"); state.onApproval();
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
        if (file.endsWith("/trezor/signing.ts") && source === "./offscreenBridge") return "\0bunker-trezor-device";
        if (file.endsWith("/safeBunker/payer.ts")) return ({ "../accountStorage": "\0bunker-account", "../accounts/localKeyResolver": "\0bunker-key",
          "../storageLock": "\0bunker-lock", "../ledger/session": "\0bunker-session", "../trezor/session": "\0bunker-trezor-session", "../forceInclusion/nonceManager": "\0bunker-nonce" } as Record<string, string>)[source];
      },
      load(id) {
        const s = "const s = globalThis.__bunkerLedgerQa;";
        if (id === "\0bunker-account") return s + "export const getAccountById = async () => s.account;";
        if (id === "\0bunker-key") return "export const getLocalPrivateKeyForAccount = async () => { throw Error('Hardware keys must never be read'); };";
        if (id === "\0bunker-lock") return s + "export const WALLET_SECRET_OPERATION_LOCK_KEY = 'wallet'; export const withStorageLock = async (key, work) => { s.locked = true; try { return await work(); } finally { s.locked = false; } };";
        if (id === "\0bunker-trezor-session") return "export const ensureTrezorSigningSession = async () => 'master';";
        if (id === "\0bunker-session") return "export const ensureLedgerSigningSession = async () => 'master';";
        if (id === "\0bunker-nonce") return s + "export const getNextNonce = async () => 7; export const resetNonce = () => { s.resets++; };";
        if (id === "\0bunker-trezor-device") return s + `
          import { privateKeyToAccount } from 'viem/accounts';
          import { parseTransaction } from 'viem';
          export const signTrezorTransaction = async input => {
            const t = input.transaction;
            s.events.push('device approval'); s.onApproval();
            if (s.locked) throw Error('Device approval must not hold the secret lock');
            const raw = await privateKeyToAccount('0x' + '11'.repeat(32)).signTransaction({
              type: 'eip1559', chainId: t.chainId, to: t.to, data: t.data,
              value: BigInt(t.value), nonce: Number(BigInt(t.nonce)), gas: BigInt(t.gasLimit),
              maxFeePerGas: BigInt(t.maxFeePerGas), maxPriorityFeePerGas: BigInt(t.maxPriorityFeePerGas)
            });
            const parsed = parseTransaction(raw);
            return { r: parsed.r, s: parsed.s, v: String(parsed.yParity), serializedTx: raw };
          };
          export const signTrezorMessage = async () => { throw Error('unexpected'); };
          export const signTrezorTypedData = signTrezorMessage;
        `;
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
    const input = { chainId: 84532, id: "request", payerId: account.id, payerAddress: account.address, to: signer.address, data: "0x", rpc: "https://fixture.example", gas: { gasLimit: "100000", maxFeePerGas: "10", maxPriorityFeePerGas: "1" },
      current: () => { if (state.changed) throw Error("Authentication changed"); },
      beforeBroadcast: async () => { state.events.push("final preflight and durable save"); assert.equal(state.locked, true); assert.ok(state.events.includes("device approval")); if (state.changed) throw Error("Safe owner changed during device approval"); } };
    await submitBunkerOuter(input);
    assert.deepEqual(state.events, ["device approval", "final preflight and durable save", "broadcast"]);
    state.events = []; state.changed = true;
    await assert.rejects(submitBunkerOuter({ ...input, current: () => {}, beforeBroadcast: async () => { state.events.push("final preflight"); throw Error("Safe owner changed during device approval"); } }), /Safe owner changed/);
    assert.deepEqual(state.events, ["device approval", "final preflight"]);
    assert.equal(state.resets, 1);
    state.changed = false;
    for (const replacement of [
      { ...account, hdPath: "m/44'/60'/1'/0/0" },
      { ...account, deviceId: "0x" + "22".repeat(20) },
      { ...account, type: "bankr" },
    ]) {
      state.account = { ...account }; state.events = [];
      state.onApproval = () => { state.account = replacement as typeof account; };
      await assert.rejects(submitBunkerOuter(input), /Gas payer changed|Choose a private-key/);
      assert.deepEqual(state.events, ["device approval"]);
    }
    state.onApproval = () => { state.changed = true; };
    state.account = { ...account }; state.events = [];
    await assert.rejects(submitBunkerOuter(input), /Authentication changed/);
    assert.deepEqual(state.events, ["device approval"]);
    state.changed = false; state.onApproval = () => {};
    state.account = { ...account, type: "bankr" } as typeof account;
    await assert.rejects(submitBunkerOuter(input), /Choose a private-key/);
  } finally { globalThis.fetch = beforeFetch; await server.close(); delete (globalThis as any).__bunkerLedgerQa; }
});
