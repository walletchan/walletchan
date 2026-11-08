import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseTransaction, keccak256 } from "viem";
import { createServer } from "vite";

import { FakeLattice, testLatticeAppKey } from "./fakeLattice";
import { LatticeProtocolClient, latticeSignerPath } from "./protocolImports";

// Twin of tests/ledger/forceInclusionSigner.test.ts. Only the device session
// (`withLatticeAccount`) is faked, and it signs through the Lattice simulator:
// real serialization, recovered-signer checks, raw adapter, final lock
// boundary and authority checks are exercised.
test("Lattice force-inclusion raw signing preserves device and session authority", async (t) => {
  const HD_PATH = "m/44'/60'/0'/0/0";
  const device = new FakeLattice();
  const client = new LatticeProtocolClient({ appKey: testLatticeAppKey(), transport: device, sleep: async () => {} });
  await client.connect();
  const signerPath = latticeSignerPath(HD_PATH);
  const account = { id: "lattice", type: "lattice", address: device.addressFor(signerPath), deviceId: "device", hdPath: HD_PATH, hdIndex: 0 };
  const other = new FakeLattice().addressFor(latticeSignerPath("m/44'/60'/0'/0/9"));
  const state = {
    current: { ...account }, epoch: "epoch", passwordType: "master" as string | null,
    locked: false, deviceCalls: [] as any[], sends: [] as any[], keyReads: 0,
    duringDevice: async () => {}, reject: false, client, signerPath,
  };
  Object.assign(globalThis, { __fiSigner: state });
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const server = await createServer({ root, configFile: false, server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true }, resolve: { alias: { "@": path.join(root, "src") } },
    plugins: [{ name: "fi-signer-boundaries", enforce: "pre",
      resolveId(source, importer) {
        const file = importer?.split("?", 1)[0] ?? "";
        if (file.endsWith("/lattice/signing.ts") && source === "./operations") return "\0fi-device";
        if (file.endsWith("/forceInclusion/rawSigner.ts")) return ({
          "../accountStorage": "\0fi-account", "../accounts/localKeyResolver": "\0fi-key",
          "../authTransition": "\0fi-epoch", "../sessionCache": "\0fi-session",
          "../lattice/session": "\0fi-unlock", "../ledger/session": "\0fi-ledger-unlock", "../storageLock": "\0fi-lock",
        } as Record<string, string>)[source];
      },
      load(id) {
        const s = "const s = globalThis.__fiSigner;";
        if (id === "\0fi-account") return s + "export const getAccountById = async () => s.current;";
        if (id === "\0fi-key") return s + "export const getLocalPrivateKeyForAccount = async () => { s.keyReads++; throw Error('No hardware key'); };";
        if (id === "\0fi-epoch") return s + "export const getAuthCeremonyEpoch = () => s.epoch; export const isCurrentAuthCeremonyEpoch = e => e === s.epoch;";
        if (id === "\0fi-session") return s + "export const getPasswordType = () => s.passwordType;";
        if (id === "\0fi-unlock") return s + "export const ensureLatticeSigningSession = async () => { if (!s.passwordType) throw Error('Locked'); };";
        if (id === "\0fi-ledger-unlock") return "export const ensureLedgerSigningSession = async () => { throw Error('unexpected'); };";
        if (id === "\0fi-lock") return s + "export const WALLET_SECRET_OPERATION_LOCK_KEY = 'wallet'; export const withStorageLock = async (k, f) => { s.locked = true; try { return await f(); } finally { s.locked = false; } };";
        if (id === "\0fi-device") return s + `
          export const withLatticeAccount = async (input, run) => {
            if (s.locked) throw Error('Wallet lock held during device prompt');
            s.deviceCalls.push(input); await s.duringDevice();
            if (s.reject) throw Error('Device rejected');
            return run({ client: s.client, signerPath: s.signerPath, signal: undefined });
          };`;
      },
    }],
  });
  try {
    const { createRawForceInclusionSigner } = await server.ssrLoadModule("/src/chrome/forceInclusion/rawSigner.ts");
    const { signPreparedLatticeTransaction } = await server.ssrLoadModule("/src/chrome/lattice/signing.ts");
    const transaction = { chainId: 4663, type: "eip1559", nonce: 7, to: account.address, value: 1n, gas: 21000n, maxFeePerGas: 10n, maxPriorityFeePerGas: 1n };
    const reset = () => {
      state.current = { ...account }; state.epoch = "epoch"; state.passwordType = "master";
      state.deviceCalls = []; state.sends = []; state.reject = false; state.duringDevice = async () => {};
    };
    for (const passwordType of ["master", "agent"]) await t.test(`${passwordType} signs a child without sending, then broadcasts exact parent bytes`, async () => {
      reset(); state.passwordType = passwordType;
      const signer = await createRawForceInclusionSigner({ account, opId: "request" });
      const child = await signer.signChild(transaction);
      assert.equal(parseTransaction(child).chainId, 4663);
      assert.equal(state.sends.length, 0);
      let checked = false;
      const parent = { ...transaction, chainId: 1, nonce: 9, data: child, value: 0n };
      const rpc = { prepareTransactionRequest: async () => parent, signTransaction: signer.account.signTransaction,
        request: async ({ params }: any) => { assert.equal(state.locked, true); assert.equal(checked, true); state.sends.push(params[0]); return keccak256(params[0]); } };
      const result = await signer.broadcast(rpc, parent, { chainId: 1, supportsSyncSend: false, beforeBroadcast: async () => { checked = true; } });
      assert.equal(parseTransaction(state.sends[0]).chainId, 1);
      assert.equal(parseTransaction(state.sends[0]).data, child);
      assert.equal(result.txHash, keccak256(state.sends[0]));
      assert.equal(state.deviceCalls.length, 2);
      assert.equal(state.keyReads, 0);
    });
    for (const [name, mutate] of [
      ["lock", () => { state.passwordType = null; }],
      ["new session", () => { state.epoch = "changed"; }],
      ["removed account", () => { state.current = null as any; }],
      ["changed device", () => { state.current.deviceId = "other"; }],
      ["changed derivation", () => { state.current.hdPath = "m/44'/60'/1'/0/0"; }],
    ] as const) await t.test(`${name} during a device prompt blocks signed-byte release`, async () => {
      reset(); const signer = await createRawForceInclusionSigner({ account, opId: "request" });
      state.duringDevice = async () => mutate();
      await assert.rejects(signer.signChild(transaction), /authorization changed|no longer available/);
      assert.equal(state.sends.length, 0);
    });
    await t.test("a wrong recovered signer and device rejection fail closed", async () => {
      reset();
      const wrong = await createRawForceInclusionSigner({ account: { ...account, address: other }, opId: "request" });
      state.current = { ...account, address: other };
      await assert.rejects(wrong.signChild(transaction), /different account/);
      reset(); state.reject = true;
      const fresh = await createRawForceInclusionSigner({ account, opId: "request" });
      await assert.rejects(fresh.signChild(transaction), /Device rejected/);
    });
    await t.test("locked wallets and unsupported transaction types never prompt", async () => {
      reset(); state.passwordType = null;
      await assert.rejects(createRawForceInclusionSigner({ account, opId: "request" }), /Locked/);
      await assert.rejects(signPreparedLatticeTransaction({ account, opId: "request", transaction: { ...transaction, type: "eip7702" } }), /Unsupported/);
      await assert.rejects(signPreparedLatticeTransaction({ account, opId: "request", transaction: { ...transaction, chainId: undefined } }), /chain ID/);
      assert.equal(state.deviceCalls.length, 0);
    });
  } finally { await server.close(); delete (globalThis as any).__fiSigner; }
});
