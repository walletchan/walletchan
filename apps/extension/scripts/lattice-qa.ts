/**
 * Manual Lattice real-device QA kit (see _docs/LATTICE.md, "Real-device test matrix").
 *
 * Serve mode: a localhost dapp page with one button per matrix row. Requests go
 * to WalletChan through EIP-6963, transactions target a local anvil chain, and
 * every result is appended to a JSONL file.
 *
 *   anvil --port 8563 --chain-id 31337
 *   npx tsx scripts/lattice-qa.ts                      # http://localhost:8564
 *   npx tsx scripts/lattice-qa.ts --verify             # check the logged results
 *
 * Verify mode recovers each signature and reads each transaction from the
 * chain, independent of the wallet's own checks.
 */
import { Buffer } from "node:buffer";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  createPublicClient,
  getAddress,
  http,
  recoverMessageAddress,
  recoverTypedDataAddress,
  type Hex,
} from "viem";

const { values } = parseArgs({
  options: {
    port: { type: "string", default: "8564" },
    rpc: { type: "string", default: "http://127.0.0.1:8563" },
    out: { type: "string", default: path.join(os.tmpdir(), "lattice-qa-results.jsonl") },
    verify: { type: "boolean", default: false },
  },
});

const CHAIN_ID = 31337;

const PAGE = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Lattice QA</title>
<style>
body{font:15px/1.5 system-ui,sans-serif;max-width:760px;margin:24px auto;padding:0 16px}
button{font:inherit;padding:6px 12px;margin:3px 0;width:100%;text-align:left;cursor:pointer}
h2{font-size:16px;margin:18px 0 4px}pre{background:#f4f4f4;padding:10px;white-space:pre-wrap;word-break:break-all;font-size:12px}
.ok{color:#126b12}.err{color:#a11}
</style></head><body>
<h1>WalletChan Lattice QA</h1>
<p>Local chain 31337 at RPC_URL. Row IDs match the matrix in _docs/LATTICE.md.</p>
<p id="wallet">Looking for WalletChan...</p>
<h2>Session</h2>
<button data-id="connect">Connect</button>
<button data-id="chain">Add and switch to chain 31337</button>
<h2>Messages</h2>
<button data-id="M1">M1 personal_sign UTF-8 text</button>
<button data-id="M2">M2 personal_sign raw bytes (not UTF-8)</button>
<button data-id="M3">M3 eth_signTypedData_v4, flat struct</button>
<button data-id="M4">M4 eth_signTypedData_v4, nested struct (Permit2 PermitSingle)</button>
<h2>Transactions (to yourself, local chain only)</h2>
<button data-id="T1">T1 EIP-1559 send, 0.001 ETH</button>
<button data-id="T2">T2 legacy request (gasPrice)</button>
<button data-id="T3">T3 EIP-2930 request (gasPrice + accessList)</button>
<button data-id="T4">T4 2,000-byte calldata (multi-frame)</button>
<button data-id="T5">T5 4,000-byte calldata (prehashed above 3,019 bytes)</button>
<button data-id="T6">T6 ERC-20 transfer(address,uint256) calldata</button>
<button data-id="T12">T12 grantRole(bytes32,address): bytes32 argument</button>
<button data-id="T13">T13 Uniswap exactInputSingle((...)): tuple argument</button>
<pre id="out"></pre>
<script>
const CHAIN = { chainId: "0x7a69", chainName: "Lattice QA (anvil)", rpcUrls: ["RPC_URL"],
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 } };
const FLAT = { types: { EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }],
  Note: [{ name: "text", type: "string" }, { name: "amount", type: "uint256" }] },
  primaryType: "Note", domain: { name: "Lattice QA", version: "1", chainId: 31337 },
  message: { text: "WalletChan Lattice QA", amount: "42" } };
const NESTED = { types: {
  EIP712Domain: [{ name: "name", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }],
  PermitDetails: [{ name: "token", type: "address" }, { name: "amount", type: "uint160" }, { name: "expiration", type: "uint48" }, { name: "nonce", type: "uint48" }],
  PermitSingle: [{ name: "details", type: "PermitDetails" }, { name: "spender", type: "address" }, { name: "sigDeadline", type: "uint256" }] },
  primaryType: "PermitSingle",
  domain: { name: "Permit2", chainId: 31337, verifyingContract: "0x000000000022D473030F116dDEE9F6B43aC78BA3" },
  message: { details: { token: "0x1111111111111111111111111111111111111111", amount: "1000000", expiration: "1900000000", nonce: "0" },
    spender: "0x2222222222222222222222222222222222222222", sigDeadline: "1900000000" } };
const hex = (bytes) => "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const filler = (n) => "0x" + "ab".repeat(n);
let provider = null, account = null;
const out = document.getElementById("out");
function show(line, cls) { const d = document.createElement("div"); d.textContent = line; d.className = cls; out.prepend(d); }
async function log(id, ok, payload) {
  show(id + ": " + (ok ? "ok " : "error ") + JSON.stringify(payload), ok ? "ok" : "err");
  try { await fetch("/log", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, ok, payload, account, at: new Date().toISOString() }) }); } catch {}
}
function watch(p) {
  p.on?.("chainChanged", (c) => log("chainChanged", true, c));
  p.on?.("accountsChanged", (a) => log("accountsChanged", true, a));
}
window.addEventListener("eip6963:announceProvider", (e) => {
  const { info, provider: p } = e.detail;
  if (/walletchan/i.test(info.name + " " + (info.rdns || ""))) {
    provider = p; watch(p); document.getElementById("wallet").textContent = "Using " + info.name + " (" + info.rdns + ")";
  }
});
window.dispatchEvent(new Event("eip6963:requestProvider"));
async function localChain() {
  const id = await provider.request({ method: "eth_chainId" });
  if (id !== CHAIN.chainId) throw new Error("Wallet chain is " + parseInt(id, 16) + ", not 31337. Use the chain button first.");
}
const send = async (tx) => { await localChain(); return { hash: await provider.request({ method: "eth_sendTransaction",
  params: [{ from: account, to: account, chainId: CHAIN.chainId, ...tx }] }) }; };
const signTyped = async (data) => { await localChain(); return { typedData: data,
  signature: await provider.request({ method: "eth_signTypedData_v4", params: [account, JSON.stringify(data)] }) }; };
const signText = async (bytes) => ({ message: hex(bytes),
  signature: await provider.request({ method: "personal_sign", params: [hex(bytes), account] }) });
const ACTIONS = {
  connect: async () => { [account] = await provider.request({ method: "eth_requestAccounts" }); return account; },
  chain: async () => {
    try { await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN.chainId }] }); }
    catch { await provider.request({ method: "wallet_addEthereumChain", params: [CHAIN] });
            await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN.chainId }] }); }
    return provider.request({ method: "eth_chainId" });
  },
  M1: () => signText(new TextEncoder().encode("WalletChan Lattice QA: M1 text")),
  M2: () => signText(Uint8Array.from([0xde, 0xad, 0xbe, 0xef, 0x00, 0xff, 0x80, 0x81])),
  M3: () => signTyped(FLAT),
  M4: () => signTyped(NESTED),
  T1: () => send({ value: "0x38d7ea4c68000" }),
  T2: () => send({ value: "0x0", gasPrice: "0x3b9aca00" }),
  T3: () => send({ value: "0x0", gasPrice: "0x3b9aca00", accessList: [{ address: "0x1111111111111111111111111111111111111111", storageKeys: [] }] }),
  T4: () => send({ value: "0x0", data: filler(2000) }),
  T5: () => send({ value: "0x0", data: filler(4000) }),
  T6: () => send({ value: "0x0", data: "0xa9059cbb" + "000000000000000000000000" + "2222222222222222222222222222222222222222"
    + "00000000000000000000000000000000000000000000000000000000000f4240" }),
  // grantRole(MINTER_ROLE, 0x2222...): the device should show the full 32-byte role.
  T12: () => send({ value: "0x0", data: "0x2f2ff15d9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6"
    + "0000000000000000000000002222222222222222222222222222222222222222" }),
  // SwapRouter02 exactInputSingle: WETH -> USDC, fee 500, 1 WETH in, 3,000 USDC minimum.
  T13: () => send({ value: "0x0", data: "0x04e45aaf000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
    + "000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
    + "00000000000000000000000000000000000000000000000000000000000001f4"
    + "0000000000000000000000002222222222222222222222222222222222222222"
    + "0000000000000000000000000000000000000000000000000de0b6b3a7640000"
    + "00000000000000000000000000000000000000000000000000000000b2d05e00"
    + "0000000000000000000000000000000000000000000000000000000000000000" }),
};
for (const button of document.querySelectorAll("button[data-id]")) {
  button.onclick = async () => {
    const id = button.dataset.id;
    if (!provider) return log(id, false, "No WalletChan provider found");
    try {
      if (!account && id !== "connect") [account] = await provider.request({ method: "eth_requestAccounts" });
      await log(id, true, await ACTIONS[id]());
    } catch (err) { await log(id, false, { code: err.code, message: err.message }); }
  };
}
</script></body></html>`;

interface QaRow {
  id: string;
  ok: boolean;
  payload: unknown;
  account: string | null;
  at: string;
}

function serve(): void {
  const page = PAGE.replaceAll("RPC_URL", values.rpc as string);
  const server = createServer((request, response) => {
    if (request.method === "GET" && (request.url === "/" || request.url === "/index.html")) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(page);
      return;
    }
    if (request.method === "POST" && request.url === "/log") {
      let body = "";
      request.on("data", (chunk: Buffer) => {
        if (body.length < 65_536) body += chunk.toString("utf8");
      });
      request.on("end", () => {
        try {
          const row = JSON.parse(body) as QaRow;
          appendFileSync(values.out as string, `${JSON.stringify(row)}\n`);
          console.log(`${row.id} ${row.ok ? "ok" : "ERROR"} ${JSON.stringify(row.payload).slice(0, 200)}`);
        } catch {
          // A malformed log line is dropped; the page shows its own result.
        }
        response.writeHead(204).end();
      });
      return;
    }
    response.writeHead(404).end();
  });
  server.listen(Number(values.port), "127.0.0.1", () => {
    console.log(`Lattice QA page: http://localhost:${values.port}  (results: ${values.out})`);
  });
}

async function verify(): Promise<void> {
  if (!existsSync(values.out as string)) throw new Error(`No results at ${values.out}`);
  const rows = readFileSync(values.out as string, "utf8").trim().split("\n").map((line) => JSON.parse(line) as QaRow);
  const client = createPublicClient({ transport: http(values.rpc as string) });
  const latest = new Map<string, QaRow>();
  for (const row of rows) if (/^[MT]\d+$/.test(row.id) && row.ok) latest.set(row.id, row);
  let failures = 0;
  for (const [id, row] of [...latest].sort(([a], [b]) => a.localeCompare(b))) {
    const expected = getAddress(row.account as string);
    const payload = row.payload as Record<string, unknown>;
    let detail: string;
    let pass: boolean;
    if (id === "M1" || id === "M2") {
      const signer = await recoverMessageAddress({ message: { raw: payload.message as Hex }, signature: payload.signature as Hex });
      pass = signer === expected;
      detail = `signer ${signer}`;
    } else if (id === "M3" || id === "M4") {
      const typed = payload.typedData as { domain: object; types: Record<string, unknown>; primaryType: string; message: object };
      const types = Object.fromEntries(Object.entries(typed.types).filter(([name]) => name !== "EIP712Domain"));
      const signer = await recoverTypedDataAddress({ ...typed, types, signature: payload.signature as Hex } as never);
      pass = signer === expected;
      detail = `signer ${signer}`;
    } else {
      const hash = payload.hash as Hex;
      const [tx, receipt] = await Promise.all([client.getTransaction({ hash }), client.getTransactionReceipt({ hash })]);
      pass = receipt.status === "success" && getAddress(tx.from) === expected && tx.chainId === CHAIN_ID;
      detail = `type ${tx.type}, chain ${tx.chainId}, nonce ${tx.nonce}, calldata ${(tx.input.length - 2) / 2} B, ${receipt.status}`;
    }
    if (!pass) failures += 1;
    console.log(`${pass ? "PASS" : "FAIL"} ${id}  ${detail}  (${row.at})`);
  }
  for (const id of ["M1", "M2", "M3", "M4", "T1", "T2", "T3", "T4", "T5", "T6", "T12", "T13"]) {
    if (!latest.has(id)) console.log(`---- ${id}  no successful result logged`);
  }
  process.exitCode = failures > 0 ? 1 : 0;
}

if (values.verify) {
  verify().catch((error: unknown) => {
    console.error(`FAILED: ${(error as Error).message}`);
    process.exitCode = 1;
  });
} else {
  serve();
}
