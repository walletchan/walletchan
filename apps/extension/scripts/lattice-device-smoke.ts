/**
 * Real-device smoke test for the Lattice protocol port (phase 0).
 *
 * Read-only by default: connect, report firmware and wallet, fetch addresses.
 * Signing steps need approval on the Lattice screen and never broadcast.
 *
 *   npx tsx scripts/lattice-device-smoke.ts --ape-grid
 *   npx tsx scripts/lattice-device-smoke.ts --ape-grid --sign-message "hello"
 *   npx tsx scripts/lattice-device-smoke.ts --ape-grid --sign-tx
 *   npx tsx scripts/lattice-device-smoke.ts --device-id ABC123 --pair
 *
 * --ape-grid reuses ape-grid-lattice's pairing (~/.ape/grid or $APE_GRID_DATA_DIR)
 * and checks the addresses against its saved accounts.
 */
import { Buffer } from "node:buffer";
import { createPrivateKey } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";

import { bytesToHex, getAddress, hexToBytes, recoverMessageAddress, recoverTransactionAddress, serializeSignature } from "viem";

import { GRIDPLUS_LATTICE_RELAY_URL } from "../src/constants/externalUrls";
import {
  LatticeProtocolClient,
  createLatticeRelayTransport,
  formatLatticeFirmware,
  generateLatticeAppPrivateKey,
  latticeSignerPath,
  signLatticePersonalMessage,
  signLatticeTransaction,
} from "../src/chrome/lattice/protocol";

const { values } = parseArgs({
  options: {
    "ape-grid": { type: "boolean", default: false },
    "device-id": { type: "string" },
    "app-key-hex": { type: "string" },
    endpoint: { type: "string", default: GRIDPLUS_LATTICE_RELAY_URL },
    path: { type: "string", default: "m/44'/60'/0'/0/0" },
    count: { type: "string", default: "2" },
    pair: { type: "boolean", default: false },
    "sign-message": { type: "string" },
    "sign-tx": { type: "boolean", default: false },
    "chain-id": { type: "string", default: "11155111" },
  },
});

function apeGridDir(): string {
  return process.env.APE_GRID_DATA_DIR ?? path.join(os.homedir(), ".ape", "grid");
}

/** ape_grid stores the P-256 app key as PKCS8 DER; extract the raw 32-byte scalar. */
function loadApeGridAppKey(dir: string): Uint8Array {
  const jwk = createPrivateKey({ key: readFileSync(path.join(dir, "app_key")), format: "der", type: "pkcs8" }).export({
    format: "jwk",
  });
  if (jwk.crv !== "P-256" || typeof jwk.d !== "string") throw new Error("ape_grid app_key is not a P-256 key");
  return new Uint8Array(Buffer.from(jwk.d, "base64url"));
}

function apeGridAccounts(dir: string): Array<{ alias: string; address: string; hdpath: string }> {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({ alias: f.slice(0, -5), ...JSON.parse(readFileSync(path.join(dir, f), "utf8")) }));
}

async function main(): Promise<void> {
  let deviceId = values["device-id"];
  let appKey: Uint8Array | undefined = values["app-key-hex"] ? hexToBytes(values["app-key-hex"] as `0x${string}`) : undefined;
  const dir = apeGridDir();
  if (values["ape-grid"]) {
    if (!existsSync(path.join(dir, "app_key"))) throw new Error(`No ape_grid pairing in ${dir}`);
    deviceId ??= readFileSync(path.join(dir, "device_id"), "utf8").trim();
    appKey ??= loadApeGridAppKey(dir);
  }
  if (!deviceId) throw new Error("Pass --device-id or --ape-grid");
  if (!appKey) {
    appKey = generateLatticeAppPrivateKey();
    console.log("Generated a new app key. Keep it to reuse this pairing:");
    console.log(`  --app-key-hex ${bytesToHex(appKey)}`);
  }

  const client = new LatticeProtocolClient({
    appPrivateKey: appKey,
    transport: createLatticeRelayTransport({ deviceId, baseUrl: values.endpoint as string, timeoutMs: 120_000 }),
  });

  console.log(`Connecting to ${values.endpoint} ...`);
  let connect = await client.connect();
  console.log(`  firmware ${formatLatticeFirmware(connect.firmware)}, paired: ${connect.isPaired}`);
  if (!connect.isPaired) {
    if (!values.pair) throw new Error("This app key is not paired. Re-run with --pair.");
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const code = (await rl.question("Pairing code shown on the Lattice: ")).trim();
    rl.close();
    connect = await client.pair(code);
    console.log("  paired");
  }
  const safeCard = connect.walletUids && connect.walletUids.external.some((b) => b !== 0);
  console.log(`  active wallet: ${safeCard ? "SafeCard" : "internal"} (${bytesToHex(connect.activeWalletUid!).slice(0, 10)}...)`);

  const signerPath = latticeSignerPath(values.path as string);
  const count = Number(values.count);
  const startPath = [...signerPath];
  const addresses = (await client.getAddresses({ startPath, n: count })) as string[];
  console.log(`Addresses from ${values.path} (last index incremented):`);
  addresses.forEach((a, i) => console.log(`  [${i}] ${a}`));

  if (values["ape-grid"]) {
    const base = values.path as string;
    const prefix = base.slice(0, base.lastIndexOf("/") + 1);
    const first = Number(base.slice(base.lastIndexOf("/") + 1));
    for (const acct of apeGridAccounts(dir)) {
      if (!acct.hdpath?.startsWith(prefix)) continue;
      const idx = Number(acct.hdpath.slice(prefix.length)) - first;
      if (idx < 0 || idx >= addresses.length) continue;
      const match = getAddress(addresses[idx]) === getAddress(acct.address);
      console.log(`  ape_grid "${acct.alias}" ${acct.hdpath}: ${match ? "MATCH" : "MISMATCH"}`);
      if (!match) process.exitCode = 1;
    }
  }

  const expected = getAddress(addresses[0]);
  if (values["sign-message"] !== undefined) {
    console.log("Approve the message on the Lattice ...");
    const message = new TextEncoder().encode(values["sign-message"]);
    const sig = await signLatticePersonalMessage(client, { signerPath, message });
    const recovered = await recoverMessageAddress({
      message: { raw: message },
      signature: serializeSignature({ r: sig.r, s: sig.s, yParity: sig.yParity }),
    });
    console.log(`  recovered ${recovered}: ${recovered === expected ? "MATCH" : "MISMATCH"}`);
    if (recovered !== expected) process.exitCode = 1;
  }

  if (values["sign-tx"]) {
    const chainId = Number(values["chain-id"]);
    console.log(`Approve a 0-value self-transfer on chain ${chainId} on the Lattice (NOT broadcast) ...`);
    const signed = await signLatticeTransaction(client, {
      signerPath,
      tx: {
        type: "eip1559",
        chainId,
        nonce: 0,
        to: expected,
        value: 0n,
        gas: 21_000n,
        maxFeePerGas: 1_000_000_000n,
        maxPriorityFeePerGas: 1_000_000n,
      },
    });
    const recovered = await recoverTransactionAddress({ serializedTransaction: signed.serialized as never });
    console.log(`  signed bytes: ${signed.serialized.slice(0, 42)}... (${(signed.serialized.length - 2) / 2} bytes, not sent)`);
    console.log(`  recovered ${recovered}: ${recovered === expected ? "MATCH" : "MISMATCH"}`);
    if (recovered !== expected) process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`FAILED: ${(err as Error).message}`);
  process.exitCode = 1;
});
