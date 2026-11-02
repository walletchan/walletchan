/**
 * Captures the exact ETH_MSG sign requests gridplus-sdk 4.0.0 sends, as
 * byte-parity fixtures for WalletChan's Lattice protocol port.
 *
 * The real SDK `Client` talks to WalletChan's Lattice simulator through a
 * stubbed `fetch` that speaks the GridPlus relay format. The simulator keeps
 * each request exactly as received; this script writes them to
 * apps/extension/tests/lattice/fixtures/gridplusSdkEthMsg.json, which the
 * normal test suite reads. Nothing here ships in the extension.
 *
 *   npm ci --ignore-scripts && npm run generate
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "gridplus-sdk";

import { FakeLattice } from "../../apps/extension/tests/lattice/fakeLattice";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, "../../apps/extension/tests/lattice/fixtures/gridplusSdkEthMsg.json");
const RELAY = "https://lattice-sdk-parity.invalid";
const H = 0x80000000;
const SIGNER_PATH = [H + 44, H + 60, H + 0, 0, 0];

const device = new FakeLattice();

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.startsWith(`${RELAY}/`)) throw new Error(`Unexpected fetch to ${url}`);
  const { data } = JSON.parse(String(init?.body)) as { data: { type: string; data: number[] } };
  const reply = await device.send(Uint8Array.from(data.data));
  return new Response(JSON.stringify({ status: 200, message: Buffer.from(reply).toString("hex") }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}) as typeof fetch;

const ascii = (text: string) => `0x${Buffer.from(text, "utf8").toString("hex")}`;
const repeat = (length: number) => ascii("WalletChan Lattice ".repeat(Math.ceil(length / 19)).slice(0, length));

const PERSONAL: Array<{ name: string; payload: string }> = [
  { name: "ascii short", payload: ascii("hi") },
  { name: "ascii sign-in", payload: ascii("Sign in to WalletChan") },
  { name: "ascii with newline and tab", payload: ascii("line one\nline\ttwo") },
  { name: "non-ascii bytes", payload: "0xdeadbeef00ff8081" },
  { name: "utf-8 non-ascii text", payload: ascii("check ✓ done") },
  { name: "empty", payload: "0x" },
  { name: "1540 bytes, fills the base frame", payload: repeat(1540) },
  { name: "1541 bytes, first extra frame", payload: repeat(1541) },
  { name: "2000 bytes", payload: repeat(2000) },
  { name: "2968 bytes, largest sent in full", payload: repeat(2968) },
  { name: "2969 bytes, prehashed", payload: repeat(2969) },
];

const SAFE = "0x5aFE3855358E112B5647B952709E6165e1c1eEEe";
const ALICE = "0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826";
const BOB = "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB";

const TYPED: Array<{ name: string; payload: unknown }> = [
  {
    name: "flat struct (QA M3)",
    payload: {
      types: {
        EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }],
        Note: [{ name: "text", type: "string" }, { name: "amount", type: "uint256" }],
      },
      primaryType: "Note",
      domain: { name: "Lattice QA", version: "1", chainId: 31337 },
      message: { text: "WalletChan Lattice QA", amount: "42" },
    },
  },
  {
    name: "nested struct, Permit2 PermitSingle (QA M4)",
    payload: {
      types: {
        EIP712Domain: [{ name: "name", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }],
        PermitDetails: [
          { name: "token", type: "address" },
          { name: "amount", type: "uint160" },
          { name: "expiration", type: "uint48" },
          { name: "nonce", type: "uint48" },
        ],
        PermitSingle: [{ name: "details", type: "PermitDetails" }, { name: "spender", type: "address" }, { name: "sigDeadline", type: "uint256" }],
      },
      primaryType: "PermitSingle",
      domain: { name: "Permit2", chainId: 31337, verifyingContract: "0x000000000022D473030F116dDEE9F6B43aC78BA3" },
      message: {
        details: { token: "0x1111111111111111111111111111111111111111", amount: "1000000", expiration: "1900000000", nonce: "0" },
        spender: "0x2222222222222222222222222222222222222222",
        sigDeadline: "1900000000",
      },
    },
  },
  {
    name: "Safe SafeTx (owner approval)",
    payload: {
      types: {
        EIP712Domain: [{ name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }],
        SafeTx: [
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "data", type: "bytes" },
          { name: "operation", type: "uint8" },
          { name: "safeTxGas", type: "uint256" },
          { name: "baseGas", type: "uint256" },
          { name: "gasPrice", type: "uint256" },
          { name: "gasToken", type: "address" },
          { name: "refundReceiver", type: "address" },
          { name: "nonce", type: "uint256" },
        ],
      },
      primaryType: "SafeTx",
      domain: { chainId: 1, verifyingContract: SAFE },
      message: {
        to: BOB,
        value: "1000000000000000000",
        data: "0xa9059cbb000000000000000000000000cd2a3d9f938e13cd947ec05abc7fe734df8dd82600000000000000000000000000000000000000000000000000000000000f4240",
        operation: 0,
        safeTxGas: "0",
        baseGas: "0",
        gasPrice: "0",
        gasToken: "0x0000000000000000000000000000000000000000",
        refundReceiver: "0x0000000000000000000000000000000000000000",
        nonce: 7,
      },
    },
  },
  {
    name: "arrays of structs and addresses (EIP-712 Mail example)",
    payload: {
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
        Person: [{ name: "name", type: "string" }, { name: "wallets", type: "address[]" }],
        Mail: [{ name: "from", type: "Person" }, { name: "to", type: "Person[]" }, { name: "contents", type: "string" }],
      },
      primaryType: "Mail",
      domain: { name: "Ether Mail", version: "1", chainId: 1, verifyingContract: "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC" },
      message: {
        from: { name: "Cow", wallets: [ALICE, "0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF"] },
        to: [{ name: "Bob", wallets: [BOB, "0xB0BdaBea57B0BDABeA57b0bdABEA57b0BDabEa57", "0xB0B0b0b0b0b0B000000000000000000000000000"] }],
        contents: "Hello, Bob!",
      },
    },
  },
  {
    name: "signed ints, bool, fixed and dynamic bytes",
    payload: {
      types: {
        EIP712Domain: [{ name: "name", type: "string" }, { name: "chainId", type: "uint256" }],
        Kitchen: [
          { name: "small", type: "int8" },
          { name: "negative", type: "int256" },
          { name: "flag", type: "bool" },
          { name: "off", type: "bool" },
          { name: "tag", type: "bytes32" },
          { name: "blob", type: "bytes" },
          { name: "big", type: "uint256" },
        ],
      },
      primaryType: "Kitchen",
      domain: { name: "Kitchen", chainId: 10 },
      message: {
        small: -5,
        negative: "-123456789012345678901234567890",
        flag: true,
        off: false,
        tag: "0x000000000000000000000000000000000000000000000000000000000000beef",
        blob: "0x0102030405",
        big: "115792089237316195423570985008687907853269984665640564039457584007913129639935",
      },
    },
  },
  {
    name: "19 fields, prehashed by field count",
    payload: {
      types: {
        EIP712Domain: [{ name: "name", type: "string" }, { name: "chainId", type: "uint256" }],
        Wide: Array.from({ length: 19 }, (_, i) => ({ name: `f${i}`, type: "uint256" })),
      },
      primaryType: "Wide",
      domain: { name: "Wide", chainId: 1 },
      message: Object.fromEntries(Array.from({ length: 19 }, (_, i) => [`f${i}`, String(i)])),
    },
  },
  {
    name: "3,500-character string, prehashed by size",
    payload: {
      types: {
        EIP712Domain: [{ name: "name", type: "string" }, { name: "chainId", type: "uint256" }],
        Long: [{ name: "text", type: "string" }],
      },
      primaryType: "Long",
      domain: { name: "Long", chainId: 1 },
      message: { text: "WalletChan Lattice ".repeat(185).slice(0, 3500) },
    },
  },
];

const hex = (bytes: Uint8Array) => `0x${Buffer.from(bytes).toString("hex")}`;
/** Envelope bytes without the trailing zero padding; tests pad back to the full size. */
const trimmed = (bytes: Uint8Array) => {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end -= 1;
  return hex(bytes.subarray(0, end));
};

async function capture(protocol: "signPersonal" | "eip712", payload: unknown, client: Client) {
  const start = device.ethMsgCaptures.length;
  let sdkError: string | null = null;
  try {
    await client.sign({ currency: "ETH_MSG", data: { protocol, payload, signerPath: SIGNER_PATH } } as never);
  } catch (error) {
    // The simulator cannot answer every protocol yet; the request is captured before the reply.
    sdkError = (error as Error).message.split("\n")[0];
  }
  const captured = device.ethMsgCaptures[start];
  if (!captured) throw new Error(`No ETH_MSG request captured for ${protocol}: ${sdkError}`);
  return { envelope: trimmed(captured.envelope), envelopeSize: captured.envelope.length, extras: captured.extras.map(hex), sdkError };
}

const client = new Client({
  baseUrl: RELAY,
  deviceId: "SDKPARITY",
  name: "WalletChan",
  privKey: Buffer.alloc(32, 7),
  retryCount: 1,
});
await client.connect("SDKPARITY");

const cases = [];
for (const item of PERSONAL) {
  cases.push({ name: item.name, protocol: "signPersonal", payload: item.payload, ...(await capture("signPersonal", item.payload, client)) });
}
for (const item of TYPED) {
  cases.push({ name: item.name, protocol: "eip712", payload: item.payload, ...(await capture("eip712", item.payload, client)) });
}

const pkg = JSON.parse((await import("node:fs")).readFileSync(path.resolve(HERE, "node_modules/gridplus-sdk/package.json"), "utf8"));
writeFileSync(
  OUT,
  `${JSON.stringify(
    {
      source: `gridplus-sdk ${pkg.version} Client.sign({ currency: "ETH_MSG" }), captured by tools/lattice-sdk-parity/generate.ts`,
      signerPath: SIGNER_PATH,
      walletUid: hex(device.internalUid),
      cases,
    },
    null,
    2,
  )}\n`,
);
console.log(`Wrote ${cases.length} cases to ${path.relative(process.cwd(), OUT)}`);
for (const c of cases) console.log(`  ${c.protocol.padEnd(12)} ${c.name}${c.sdkError ? `  (SDK after send: ${c.sdkError.slice(0, 60)})` : ""}`);
