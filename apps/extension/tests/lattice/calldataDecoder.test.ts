/** Choosing a Lattice calldata decoder from WalletChan's selector lookups, and its fallbacks. */
import assert from "node:assert/strict";
import test from "node:test";

import { encodeFunctionData, erc20Abi, parseAbi, recoverTransactionAddress, type Address, type Hex } from "viem";

import { clearLatticeDecoderCache, latticeDecoderFor } from "../../src/chrome/lattice/calldataDecoder";
import { FakeLattice } from "./fakeLattice";
import {
  LatticeProtocolClient,
  LatticeProtocolError,
  LatticeResponseCode,
  encodeEvmDecoder,
  encodeEvmDecoderForFunction,
  generateLatticeAppPrivateKey,
  latticeSignerPath,
  signLatticeTransaction,
} from "./protocolImports";

const TO = "0x000000000000000000000000000000000000dEaD" as Address;
const PATH = latticeSignerPath("m/44'/60'/0'/0/0");
const TRANSFER = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [TO, 1_000_000n] });

function stubLookups(answers: {
  /** address (lowercase) -> Sourcify v2 contract response */
  contracts?: Record<string, unknown>;
  sourcify?: string[];
  fourbyte?: Array<{ text_signature: string; created_at: string }>;
  fail?: boolean;
}) {
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    urls.push(url);
    if (answers.fail) throw new Error("offline");
    if (url.includes("/server/v2/contract/")) {
      const address = new URL(url).pathname.split("/").pop()!.toLowerCase();
      const body = answers.contracts?.[address];
      return body ? Response.json(body) : new Response("{}", { status: 404 });
    }
    if (url.includes("sourcify")) {
      const selector = new URL(url).searchParams.get("function") as string;
      const entries = (answers.sourcify ?? []).map((name) => ({ name, filtered: false }));
      return Response.json({ ok: true, result: { function: { [selector]: entries }, event: {} } });
    }
    return Response.json({ count: answers.fourbyte?.length ?? 0, results: answers.fourbyte ?? [] });
  }) as typeof fetch;
  clearLatticeDecoderCache();
  return {
    urls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

const TOKEN = "0x1111111111111111111111111111111111111111";
const IMPLEMENTATION = "0x3333333333333333333333333333333333333333";
const NAMED_TRANSFER = {
  type: "function",
  name: "transfer",
  inputs: [
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
  ],
  outputs: [{ name: "", type: "bool" }],
  stateMutability: "nonpayable",
} as const;

test("a verified contract ABI gives the device named parameters", async () => {
  const stub = stubLookups({ contracts: { [TOKEN]: { abi: [NAMED_TRANSFER] } }, sourcify: ["transfer(address,uint256)"] });
  try {
    assert.deepEqual(
      await latticeDecoderFor({ data: TRANSFER, to: TOKEN, chainId: 1 }),
      encodeEvmDecoderForFunction(NAMED_TRANSFER),
    );
  } finally {
    stub.restore();
  }
});

test("a proxy resolves to its implementation's ABI through WalletChan's fetchContractAbi", async () => {
  const stub = stubLookups({
    contracts: {
      [TOKEN]: {
        abi: [{ type: "function", name: "upgradeTo", inputs: [{ name: "impl", type: "address" }], outputs: [], stateMutability: "nonpayable" }],
        proxyResolution: { isProxy: true, implementations: [{ address: IMPLEMENTATION }] },
      },
      [IMPLEMENTATION]: { abi: [NAMED_TRANSFER] },
    },
  });
  try {
    assert.deepEqual(
      await latticeDecoderFor({ data: TRANSFER, to: TOKEN, chainId: 1 }),
      encodeEvmDecoderForFunction(NAMED_TRANSFER),
    );
  } finally {
    stub.restore();
  }
});

test("a verified ABI without the called function falls back to the 4byte signature", async () => {
  const stub = stubLookups({
    contracts: { [TOKEN]: { abi: [{ type: "function", name: "mint", inputs: [], outputs: [], stateMutability: "nonpayable" }] } },
    sourcify: ["transfer(address,uint256)"],
  });
  try {
    assert.deepEqual(await latticeDecoderFor({ data: TRANSFER, to: TOKEN, chainId: 1 }), encodeEvmDecoder("transfer(address,uint256)"));
  } finally {
    stub.restore();
  }
});

test("a token transfer gets the SDK-format decoder from the Sourcify lookup", async () => {
  const stub = stubLookups({ sourcify: ["transfer(address,uint256)"] });
  try {
    assert.deepEqual(await latticeDecoderFor({ data: TRANSFER }), encodeEvmDecoder("transfer(address,uint256)"));
  } finally {
    stub.restore();
  }
});

test("candidates that do not decode the calldata exactly are skipped", async () => {
  const stub = stubLookups({ sourcify: ["transfer(address,uint256,uint256)", "transfer(address,uint256)"] });
  try {
    assert.deepEqual(await latticeDecoderFor({ data: TRANSFER }), encodeEvmDecoder("transfer(address,uint256)"));
  } finally {
    stub.restore();
  }
});

test("calldata with trailing bytes does not re-encode exactly, so it gets no decoder", async () => {
  const stub = stubLookups({ sourcify: ["transfer(address,uint256)"] });
  try {
    assert.equal(await latticeDecoderFor({ data: `${TRANSFER}00` as Hex }), undefined);
  } finally {
    stub.restore();
  }
});

test("4byte.directory is the fallback, oldest signature first", async () => {
  const stub = stubLookups({
    fourbyte: [
      { text_signature: "transfer(address,uint256,uint256)", created_at: "2024-01-01T00:00:00Z" },
      { text_signature: "transfer(address,uint256)", created_at: "2016-01-01T00:00:00Z" },
    ],
  });
  try {
    assert.deepEqual(await latticeDecoderFor({ data: TRANSFER }), encodeEvmDecoder("transfer(address,uint256)"));
  } finally {
    stub.restore();
  }
});

test("a tuple call (Uniswap V3 exactInputSingle) gets a decoder", async () => {
  const abi = parseAbi([
    "function exactInputSingle((address,address,uint24,address,uint256,uint256,uint160)) payable returns (uint256)",
  ]);
  const data = encodeFunctionData({ abi, functionName: "exactInputSingle", args: [[TO, TO, 3000, TO, 1n, 0n, 0n]] });
  const signature = "exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))";
  const stub = stubLookups({ sourcify: [signature] });
  try {
    assert.deepEqual(await latticeDecoderFor({ data }), encodeEvmDecoder(signature));
  } finally {
    stub.restore();
  }
});

test("a type the Lattice cannot show, or a failed lookup, means raw data", async () => {
  const supports = encodeFunctionData({
    abi: parseAbi(["function supportsInterface(bytes4) view returns (bool)"]),
    functionName: "supportsInterface",
    args: ["0x01ffc9a7"],
  });
  let stub = stubLookups({ sourcify: ["supportsInterface(bytes4)"] });
  try {
    assert.equal(await latticeDecoderFor({ data: supports }), undefined);
  } finally {
    stub.restore();
  }
  stub = stubLookups({ fail: true });
  try {
    assert.equal(await latticeDecoderFor({ data: TRANSFER }), undefined);
  } finally {
    stub.restore();
  }
});

test("plain sends make no lookup, and lookups are cached per selector", async () => {
  const stub = stubLookups({ sourcify: ["transfer(address,uint256)"] });
  try {
    assert.equal(await latticeDecoderFor({}), undefined);
    assert.equal(await latticeDecoderFor({ data: "0x" }), undefined);
    assert.equal(stub.urls.length, 0);
    await latticeDecoderFor({ data: TRANSFER });
    const after = stub.urls.length;
    await latticeDecoderFor({ data: TRANSFER });
    assert.equal(stub.urls.length, after);
  } finally {
    stub.restore();
  }
});

async function connected(options: ConstructorParameters<typeof FakeLattice>[0] = {}) {
  const device = new FakeLattice(options);
  const client = new LatticeProtocolClient({ appPrivateKey: generateLatticeAppPrivateKey(), transport: device, sleep: async () => {} });
  await client.connect();
  return { device, client };
}

const TX = {
  type: "eip1559" as const,
  chainId: 1,
  nonce: 0,
  to: TO,
  value: 0n,
  data: TRANSFER,
  gas: 60_000n,
  maxFeePerGas: 2_000_000_000n,
  maxPriorityFeePerGas: 1_000_000n,
};

test("a decoder the device rejects is dropped, and the same transaction still signs", async () => {
  const { device, client } = await connected({ rejectDecoder: true });
  const signed = await signLatticeTransaction(client, {
    signerPath: PATH,
    tx: TX,
    decoder: encodeEvmDecoder("transfer(address,uint256)"),
  });
  assert.equal(await recoverTransactionAddress({ serializedTransaction: signed.serialized as never }), device.addressFor(PATH));
  assert.equal(device.signRecords.length, 1);
  assert.equal(device.signRecords[0].decoder, null);
  assert.equal(signed.decoderAttached, false);
});

test("a user rejection with a decoder attached does not send the transaction again", async () => {
  const { device, client } = await connected();
  device.queueError(LatticeResponseCode.USER_DECLINED);
  const before = device.requestCount;
  await assert.rejects(
    signLatticeTransaction(client, { signerPath: PATH, tx: TX, decoder: encodeEvmDecoder("transfer(address,uint256)") }),
    (err: unknown) => err instanceof LatticeProtocolError && err.responseCode === LatticeResponseCode.USER_DECLINED,
  );
  assert.equal(device.requestCount, before + 1);
});
