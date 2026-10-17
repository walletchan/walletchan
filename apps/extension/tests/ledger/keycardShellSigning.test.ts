import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseTransaction } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createServer } from "vite";

// Only the offscreen device boundary is faked; serialization and recovery are real.
test("Keycard Shell tx parity is a hint, and signing still fails closed", async (t) => {
  const key = privateKeyToAccount(`0x${"11".repeat(32)}`);
  const other = privateKeyToAccount(`0x${"22".repeat(32)}`);
  const state = { calls: [] as any[], flip: false, signer: key };
  Object.assign(globalThis, { __shellSigner: state });
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const server = await createServer({ root, configFile: false, server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true }, resolve: { alias: { "@": path.join(root, "src") } },
    plugins: [{ name: "shell-device", enforce: "pre",
      resolveId(source, importer) {
        if (importer?.split("?", 1)[0].endsWith("/ledger/signing.ts") && source === "./offscreenBridge") return "\0shell-device";
      },
      load(id) {
        if (id !== "\0shell-device") return;
        return `const s = globalThis.__shellSigner;
          import { parseSignature, parseTransaction } from "viem";
          export const signLedgerTransaction = async input => {
            s.calls.push(input);
            const signed = parseTransaction(await s.signer.signTransaction(parseTransaction(input.unsignedTx)));
            const v = Number(signed.yParity);
            return { r: signed.r, s: signed.s, v: s.flip ? 1 - v : v };
          };
          export const signLedgerMessage = async input => {
            s.calls.push(input);
            const signed = parseSignature(await s.signer.signMessage({ message: { raw: input.hex } }));
            const v = Number(signed.yParity) + 27;
            return { r: signed.r, s: signed.s, v: s.flip ? 55 - v : v };
          };
          export const signLedgerTypedData = async () => { throw Error("unexpected"); };`;
      },
    }],
  });
  try {
    const { signPreparedLedgerTransaction } = await server.ssrLoadModule("/src/chrome/ledger/signing.ts");
    const transaction = { chainId: 4663, type: "eip1559", nonce: 1, to: key.address, value: 1n, gas: 21000n, maxFeePerGas: 10n, maxPriorityFeePerGas: 1n };
    const shell = { id: "s", type: "ledger", vendor: "keycardShell", address: key.address, deviceId: "d", hdPath: "m/44'/60'/0'/0/0", hdIndex: 0 };
    const ledger = { ...shell, vendor: undefined };
    const sign = (account: object) => signPreparedLedgerTransaction({ opId: "op", account, transaction });

    await t.test("Shell with a wrong parity hint recovers to the pinned account", async () => {
      Object.assign(state, { calls: [], flip: true, signer: key });
      const raw = await sign(shell);
      assert.equal(parseTransaction(raw).chainId, 4663);
      assert.equal(state.calls[0].vendor, "keycardShell");
    });
    await t.test("Ledger keeps the strict single-parity check", async () => {
      Object.assign(state, { calls: [], flip: true, signer: key });
      await assert.rejects(sign(ledger), /different account/);
      assert.equal(state.calls[0].vendor, undefined);
    });
    await t.test("legacy and eip2930 transactions serialize and recover for both vendors and parity hints", async () => {
      const { gas, nonce, to, value } = transaction;
      const variants = [
        { chainId: 4663, type: "legacy", nonce, to, value, gas, gasPrice: 10n },
        { chainId: 4663, type: "eip2930", nonce, to, value, gas, gasPrice: 10n, accessList: [] },
      ];
      for (const tx of variants) {
        for (const [account, flip] of [[shell, false], [shell, true], [ledger, false]] as const) {
          Object.assign(state, { calls: [], flip, signer: key });
          const raw = await signPreparedLedgerTransaction({ opId: "op", account, transaction: tx });
          const parsed = parseTransaction(raw);
          assert.equal(parsed.type, tx.type);
          assert.equal(parsed.chainId, 4663);
        }
      }
    });
    await t.test("Shell signing with another key is rejected under both parities", async () => {
      Object.assign(state, { calls: [], flip: false, signer: other });
      await assert.rejects(sign(shell), /different account/);
    });
    await t.test("Shell personal_sign with a wrong parity hint still recovers to the pinned account", async () => {
      const { signLedgerSignatureRequest } = await server.ssrLoadModule("/src/chrome/ledger/signing.ts");
      const request = (account: object) => signLedgerSignatureRequest({ opId: "op", account, method: "personal_sign", params: ["0x68656c6c6f"], chainId: 1 });
      Object.assign(state, { calls: [], flip: true, signer: key });
      assert.match(await request(shell), /^0x[0-9a-f]{130}$/);
      await assert.rejects(request(ledger), /Ledger signed with a different account/);
      Object.assign(state, { flip: false, signer: other });
      await assert.rejects(request(shell), /Keycard Shell signed with a different account/);
    });
    await t.test("force inclusion stays off for Shell accounts", async () => {
      const { FORCE_INCLUSION_CHAINS, isForceInclusionSupportedForAccount } = await server.ssrLoadModule("/src/constants/chainRegistry.ts");
      const { isRawForceInclusionAccount } = await server.ssrLoadModule("/src/chrome/accounts/accountTypePolicy.ts");
      const chainId = [...FORCE_INCLUSION_CHAINS.keys()][0];
      assert.equal(isForceInclusionSupportedForAccount(chainId, "ledger"), true);
      assert.equal(isForceInclusionSupportedForAccount(chainId, "ledger", "single", "keycardShell"), false);
      assert.equal(isRawForceInclusionAccount(ledger), true);
      assert.equal(isRawForceInclusionAccount(shell), false);
    });
  } finally {
    await server.close();
  }
});

test("offscreen cancel by opId reaches the signer that owns the Shell operation", async () => {
  const state = { cancelled: [] as string[], release: () => {} };
  Object.assign(globalThis, { __offscreenSigners: state, chrome: { runtime: { sendMessage: async () => undefined } } });
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const signer = (name: string) => `const s = globalThis.__offscreenSigners;
    export const cancelActiveOperation = () => { s.cancelled.push("${name}"); s.release(); };
    export const signMessage = () => new Promise((resolve) => { s.release = () => resolve({ r: "0x", s: "0x", v: 27 }); });
    export const pathForScheme = () => "";`;
  const server = await createServer({ root, configFile: false, server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true }, resolve: { alias: { "@": path.join(root, "src") } },
    plugins: [{ name: "offscreen-signers", enforce: "pre",
      resolveId(source, importer) {
        if (!importer?.split("?", 1)[0].endsWith("/offscreen/ledgerMessageHandler.ts")) return;
        return ({ "./ledgerSigner": "\0ledger-signer", "./shellSigner": "\0shell-signer" } as Record<string, string>)[source];
      },
      load(id) {
        if (id === "\0ledger-signer") return signer("ledger");
        if (id === "\0shell-signer") return signer("shell");
      },
    }],
  });
  try {
    const { handleLedgerOffscreenMessage } = await server.ssrLoadModule("/src/offscreen/ledgerMessageHandler.ts");
    const pending = handleLedgerOffscreenMessage({ type: "offscreen:ledgerSignMessage", opId: "op-1", vendor: "keycardShell", deviceId: "d", hdPath: "m/44'/60'/0'/0/0", hex: "0x00" });
    await handleLedgerOffscreenMessage({ type: "offscreen:ledgerCancel", opId: "op-1" });
    assert.deepEqual(state.cancelled, ["shell"]);
    assert.equal((await pending).ok, true);
  } finally {
    await server.close();
  }
});

test("a rejection on the Shell (SW 0x6982) maps to USER_REJECTED, not a generic failure", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const server = await createServer({ root, configFile: false, server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true }, resolve: { alias: { "@": path.join(root, "src") } },
    plugins: [{ name: "no-ledger", enforce: "pre",
      resolveId(source, importer) {
        if (importer?.split("?", 1)[0].endsWith("/offscreen/shellSigner.ts") && source === "./ledgerSigner") return "\0no-ledger";
      },
      load(id) { if (id === "\0no-ledger") return "export const pathForScheme = () => '';"; },
    }],
  });
  try {
    const { shellError } = await server.ssrLoadModule("/src/offscreen/shellSigner.ts");
    const ShellJS = (await import("@choppu/shelljs")).default;
    const rejected = shellError(new ShellJS.ShellError.TransportStatusError(0x6982));
    assert.equal(rejected.code, "USER_REJECTED");
    assert.equal(rejected.userMessage, "Rejected on your Keycard Shell.");
    assert.equal(shellError(new Error("boom")).code, "UNKNOWN");
    const status = (code: number) => shellError(new ShellJS.ShellError.TransportStatusError(code));
    assert.doesNotMatch(status(0x6a80).userMessage, /blind signing/i);
    assert.notEqual(status(0x6a80).code, "BLIND_SIGN_DISABLED");
    assert.notEqual(status(0x6985).code, "USER_REJECTED");
    assert.doesNotMatch(status(0x6d00).userMessage, /Ledger|Ethereum app/);
    assert.match(status(0x6f42).userMessage, /internal error/);
    // No status word: the shared transport fallbacks still apply, re-labelled.
    const unplugged = shellError(new Error("The device was disconnected."));
    assert.equal(unplugged.code, "DEVICE_DISCONNECTED");
    assert.equal(unplugged.userMessage, "Reconnect your Keycard Shell and try again.");
  } finally {
    await server.close();
  }
});

test("a Shell session holds the device until its HID handle has finished closing", async () => {
  const key = privateKeyToAccount(`0x${"11".repeat(32)}`);
  const state = { events: [] as string[], hang: true, closed: () => {}, publicKey: key.publicKey.slice(2) };
  Object.assign(globalThis, { __shellDevice: state });
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const stubs: Record<string, string> = {
    "./ledgerSigner": "export const pathForScheme = () => '';",
    "@choppu/shelljs": `const s = globalThis.__shellDevice;
      export default { Commands: class { getPublicKey() {
        return s.hang ? new Promise(() => {}) : Promise.resolve({ publicKey: s.publicKey });
      } } };`,
    "@choppu/shelljs-web-hid": `const s = globalThis.__shellDevice;
      const device = { productId: 0x21f7, opened: false, removeEventListener() {},
        open() { s.events.push("open"); device.opened = true; },
        close() {
          s.events.push("close-start");
          const done = () => { device.opened = false; s.events.push("close-end"); };
          if (!s.hang) return Promise.resolve(done());
          return new Promise((resolve) => { s.closed = () => resolve(done()); });
        } };
      export default class { static async list() { s.events.push("list"); return [device]; }
        static async open(d) { d.open(); return { device: d, onInputReport() {} }; } }`,
  };
  const server = await createServer({ root, configFile: false, server: { middlewareMode: true, hmr: false },
    // Bare packages are externalized in SSR before plugins resolve them; keep them stubbable.
    optimizeDeps: { noDiscovery: true }, resolve: { alias: { "@": path.join(root, "src") } },
    ssr: { noExternal: ["@choppu/shelljs", "@choppu/shelljs-web-hid"] },
    plugins: [{ name: "shell-hid", enforce: "pre",
      resolveId(source, importer) {
        if (importer?.split("?", 1)[0].endsWith("/offscreen/shellSigner.ts") && stubs[source]) return `\0stub:${source}`;
      },
      load(id) { if (id.startsWith("\0stub:")) return stubs[id.slice(6)]; },
    }],
  });
  try {
    const shell = await server.ssrLoadModule("/src/offscreen/shellSigner.ts");
    const first = shell.connectShell(() => {});
    while (!state.events.includes("open")) await new Promise((resolve) => setTimeout(resolve, 0));
    shell.cancelActiveOperation();
    await assert.rejects(shell.connectShell(() => {}), /in progress/);
    await assert.rejects(shell.scanAddresses("", 0, 1, "ledgerLive", undefined, () => {}), /device identity/);
    state.hang = false;
    state.closed();
    await assert.rejects(first, /cancelled/);
    const second = await shell.connectShell(() => {});
    assert.equal(second.deviceId, key.address.toLowerCase());
    assert.deepEqual(state.events.slice(0, 5), ["list", "open", "close-start", "close-end", "list"]);
  } finally {
    await server.close();
  }
});
