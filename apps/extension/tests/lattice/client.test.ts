/** End-to-end protocol client behaviour against the in-process Lattice simulator. */
import assert from "node:assert/strict";
import test from "node:test";

import {
  encodeFunctionData,
  erc20Abi,
  hashDomain,
  hashMessage,
  hashStruct,
  hexToBytes,
  keccak256,
  parseTransaction,
  recoverMessageAddress,
  recoverTransactionAddress,
  recoverTypedDataAddress,
  serializeSignature,
  type Address,
} from "viem";
import { generatePrivateKey, privateKeyToAccount, sign } from "viem/accounts";

import { FakeLattice, testLatticeAppKey } from "./fakeLattice";
import {
  LatticeProtocolClient,
  LatticeProtocolError,
  LatticeResponseCode,
  LatticeSignSchema,
  encodeEvmDecoder,
  evmTransactionPayload,
  latticeSignerPath,
  recoverLatticeSigner,
  signLatticePersonalMessage,
  signLatticeTransaction,
  signLatticeTypedData,
  signLatticeTypedDataHashes,
} from "./protocolImports";

const PATH = latticeSignerPath("m/44'/60'/0'/0/0");
const TO = "0x000000000000000000000000000000000000dEaD" as Address;

function setup(options: ConstructorParameters<typeof FakeLattice>[0] = {}) {
  const device = new FakeLattice(options);
  const sleeps: number[] = [];
  const client = new LatticeProtocolClient({
    appKey: testLatticeAppKey(),
    transport: device,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { device, client, sleeps };
}

test("connect reads firmware and the internal wallet without a SafeCard", async () => {
  const { device, client } = setup();
  const result = await client.connect();
  assert.equal(result.isPaired, true);
  assert.deepEqual(result.firmware, [0, 18, 2]);
  assert.deepEqual(result.activeWalletUid, device.internalUid);
});

test("connect prefers the SafeCard wallet when one is inserted", async () => {
  const { device, client } = setup({ safeCardInserted: true });
  const result = await client.connect();
  assert.deepEqual(result.activeWalletUid, device.externalUid);
});

test("connect accepts 144- and 160-byte wallet info and rejects shorter", async () => {
  for (const walletInfoSize of [144, 160]) {
    const { device, client } = setup({ walletInfoSize, safeCardInserted: true });
    assert.deepEqual((await client.connect()).activeWalletUid, device.externalUid);
  }
  await assert.rejects(setup({ walletInfoSize: 128 }).client.connect(), /wallet info missing/);
});

test("connect rejects firmware older than 0.15.0", async () => {
  const { client } = setup({ firmware: [0, 14, 9] });
  await assert.rejects(client.connect(), /older than the supported minimum 0\.15\.0/);
});

test("pairing: unpaired connect, wrong code fails, right code pairs and loads the wallet", async () => {
  const { device, client } = setup({ paired: false, pairingCode: "K7Q2M9XZ" });
  const first = await client.connect();
  assert.equal(first.isPaired, false);
  assert.equal(first.activeWalletUid, null);
  await assert.rejects(client.getAddresses({ startPath: PATH, n: 1 }), /No active Lattice wallet/);

  await assert.rejects(
    client.pair("WRONG000"),
    (err: unknown) => err instanceof LatticeProtocolError && err.responseCode === LatticeResponseCode.PAIR_FAILED,
  );
  const paired = await client.pair("K7Q2M9XZ");
  assert.equal(paired.isPaired, true);
  assert.deepEqual(paired.activeWalletUid, device.internalUid);
  assert.equal(device.pairedAppName, "WalletChan");
});

test("getAddresses returns the device's addresses for consecutive indices", async () => {
  const { device, client } = setup();
  await client.connect();
  const addresses = await client.getAddresses({ startPath: PATH, n: 3 });
  assert.deepEqual(addresses, [0, 1, 2].map((i) => device.addressFor([...PATH.slice(0, 4), i])));
});

test("EIP-1559 transaction: device sees the exact unsigned bytes and the result recovers to it", async () => {
  const { device, client } = setup();
  await client.connect();
  const tx = {
    type: "eip1559" as const,
    chainId: 1,
    nonce: 7,
    to: TO,
    value: 10n ** 15n,
    gas: 21000n,
    maxFeePerGas: 30_000_000_000n,
    maxPriorityFeePerGas: 1_000_000_000n,
  };
  const signed = await signLatticeTransaction(client, { signerPath: PATH, tx });
  const record = device.signRecords.at(-1)!;
  assert.equal(record.encoding, 4);
  assert.deepEqual(record.message, evmTransactionPayload(tx));
  assert.equal(signed.signer, device.addressFor(PATH));
  assert.equal(await recoverTransactionAddress({ serializedTransaction: signed.serialized as never }), device.addressFor(PATH));
  assert.equal(signed.prehashed, false);
});

test("legacy transaction uses EIP-155 v and recovers", async () => {
  const { device, client } = setup();
  await client.connect();
  const tx = { type: "legacy" as const, chainId: 10, nonce: 0, to: TO, value: 1n, gas: 21000n, gasPrice: 1_000_000_000n };
  const signed = await signLatticeTransaction(client, { signerPath: PATH, tx });
  const parsed = parseTransaction(signed.serialized);
  assert.equal(parsed.v, 10n * 2n + 35n + BigInt(signed.yParity));
  assert.equal(await recoverTransactionAddress({ serializedTransaction: signed.serialized as never }), device.addressFor(PATH));
});

test("2,000-byte calldata travels in one extra frame and still recovers", async () => {
  const { device, client } = setup();
  await client.connect();
  const tx = {
    type: "eip1559" as const,
    chainId: 1,
    nonce: 1,
    to: TO,
    data: `0x${"ab".repeat(2000)}` as const,
    gas: 500_000n,
    maxFeePerGas: 1n,
    maxPriorityFeePerGas: 1n,
  };
  const signed = await signLatticeTransaction(client, { signerPath: PATH, tx });
  const record = device.signRecords.at(-1)!;
  assert.equal(record.extraFrames, 1);
  assert.deepEqual(record.message, evmTransactionPayload(tx));
  assert.equal(await recoverTransactionAddress({ serializedTransaction: signed.serialized as never }), device.addressFor(PATH));
});

test("payload above 3,019 bytes is prehashed: the device sees only the digest", async () => {
  const { device, client } = setup();
  await client.connect();
  const tx = {
    type: "eip1559" as const,
    chainId: 1,
    nonce: 2,
    to: TO,
    data: `0x${"cd".repeat(4000)}` as const,
    gas: 900_000n,
    maxFeePerGas: 1n,
    maxPriorityFeePerGas: 1n,
  };
  const signed = await signLatticeTransaction(client, { signerPath: PATH, tx });
  const record = device.signRecords.at(-1)!;
  assert.equal(signed.prehashed, true);
  assert.equal(record.message, null);
  assert.deepEqual(record.digest, keccak256(evmTransactionPayload(tx), "bytes"));
  assert.equal(await recoverTransactionAddress({ serializedTransaction: signed.serialized as never }), device.addressFor(PATH));
});

test("calldata decoder is attached for the device to display", async () => {
  const { device, client } = setup();
  await client.connect();
  const data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [TO, 5n] });
  const decoder = encodeEvmDecoder("transfer(address,uint256)");
  const signed = await signLatticeTransaction(client, {
    signerPath: PATH,
    tx: { type: "eip1559", chainId: 1, nonce: 3, to: TO, data, gas: 60_000n, maxFeePerGas: 1n, maxPriorityFeePerGas: 1n },
    decoder,
  });
  assert.equal(signed.decoderAttached, true);
  assert.deepEqual(device.signRecords.at(-1)!.decoder, decoder);
});

test("personal_sign goes over ETH_MSG: the device gets the bare ASCII text and recovers with viem", async () => {
  const { device, client } = setup();
  await client.connect();
  const message = new TextEncoder().encode("Sign in to WalletChan");
  const sig = await signLatticePersonalMessage(client, { signerPath: PATH, message });
  const signature = serializeSignature({ r: sig.r, s: sig.s, yParity: sig.yParity });
  assert.equal(await recoverMessageAddress({ message: { raw: message }, signature }), device.addressFor(PATH));
  const record = device.signRecords.at(-1)!;
  assert.equal(record.schema, LatticeSignSchema.ETH_MSG);
  assert.equal(record.displayHex, false);
  assert.deepEqual(record.message, message);
  assert.equal(sig.digest, hashMessage({ raw: message }));
});

test("personal_sign of non-ASCII bytes asks the device to show hex", async () => {
  const { device, client } = setup();
  await client.connect();
  const message = Uint8Array.from([0xde, 0xad, 0xbe, 0xef, 0x00, 0xff]);
  const sig = await signLatticePersonalMessage(client, { signerPath: PATH, message });
  assert.equal(device.signRecords.at(-1)!.displayHex, true);
  assert.equal(sig.signer, device.addressFor(PATH));
});

test("a 2,000-byte personal message travels in one extra frame and still recovers", async () => {
  const { device, client } = setup();
  await client.connect();
  const message = new TextEncoder().encode("a".repeat(2000));
  const sig = await signLatticePersonalMessage(client, { signerPath: PATH, message });
  const record = device.signRecords.at(-1)!;
  assert.equal(record.extraFrames, 1);
  assert.deepEqual(record.message, message);
  const signature = serializeSignature({ r: sig.r, s: sig.s, yParity: sig.yParity });
  assert.equal(await recoverMessageAddress({ message: { raw: message }, signature }), device.addressFor(PATH));
});

test("a personal message above 2,968 bytes is prehashed: the device sees only the EIP-191 digest", async () => {
  const { device, client } = setup();
  await client.connect();
  const message = new TextEncoder().encode("b".repeat(2969));
  const sig = await signLatticePersonalMessage(client, { signerPath: PATH, message });
  const record = device.signRecords.at(-1)!;
  assert.equal(record.message, null);
  assert.equal(record.extraFrames, 0);
  assert.equal(sig.prehashed, true);
  const signature = serializeSignature({ r: sig.r, s: sig.s, yParity: sig.yParity });
  assert.equal(await recoverMessageAddress({ message: { raw: message }, signature }), device.addressFor(PATH));
});

test("a personal_sign reply whose signer the signature does not recover to is rejected", async () => {
  const { client } = setup({ forgedSigner: hexToBytes(TO) });
  await client.connect();
  await assert.rejects(
    signLatticePersonalMessage(client, { signerPath: PATH, message: new Uint8Array([0x68, 0x69]) }),
    /does not match its signer/,
  );
});

test("EIP-712 hash-only signing recovers as typed data", async () => {
  const { device, client } = setup();
  await client.connect();
  const typedData = {
    domain: { name: "Safe", chainId: 1, verifyingContract: TO },
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      Approve: [
        { name: "spender", type: "address" },
        { name: "amount", type: "uint256" },
      ],
    },
    primaryType: "Approve" as const,
    message: { spender: TO, amount: 42n },
  };
  const sig = await signLatticeTypedDataHashes(client, {
    signerPath: PATH,
    domainSeparator: hashDomain({ domain: typedData.domain, types: typedData.types } as never),
    messageHash: hashStruct({ data: typedData.message, primaryType: "Approve", types: typedData.types } as never),
  });
  const signature = serializeSignature({ r: sig.r, s: sig.s, yParity: sig.yParity });
  assert.equal(await recoverTypedDataAddress({ ...typedData, signature }), device.addressFor(PATH));
});

type TypedInput = {
  domain: Record<string, unknown>;
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  message: Record<string, unknown>;
};

/** The hashes WalletChan computes before signing, as in lattice/signing.ts. */
function typedHashes(typedData: TypedInput) {
  return {
    domainSeparator: hashDomain({ domain: typedData.domain, types: typedData.types } as never),
    messageHash: hashStruct({ data: typedData.message, primaryType: typedData.primaryType, types: typedData.types } as never),
  };
}

async function signTyped(client: LatticeProtocolClient, typedData: TypedInput) {
  const sig = await signLatticeTypedData(client, { signerPath: PATH, typedData, ...typedHashes(typedData) });
  const signature = serializeSignature({ r: sig.r, s: sig.s, yParity: sig.yParity });
  return { sig, recovered: await recoverTypedDataAddress({ ...typedData, signature } as never) };
}

const DOMAIN_FIELDS = [
  { name: "name", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
];

const PERMIT: TypedInput = {
  types: {
    EIP712Domain: DOMAIN_FIELDS,
    PermitDetails: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
      { name: "nonce", type: "uint48" },
    ],
    PermitSingle: [{ name: "details", type: "PermitDetails" }, { name: "spender", type: "address" }, { name: "sigDeadline", type: "uint256" }],
  },
  primaryType: "PermitSingle",
  domain: { name: "Permit2", chainId: 1, verifyingContract: "0x000000000022D473030F116dDEE9F6B43aC78BA3" },
  message: {
    details: { token: TO, amount: "1000000", expiration: 1900000000, nonce: 0 },
    spender: "0x2222222222222222222222222222222222222222",
    sigDeadline: "1900000000",
  },
};

test("EIP-712 shows the fields: the device receives the nested typed data and the signature recovers", async () => {
  const { device, client } = setup();
  await client.connect();
  const { sig, recovered } = await signTyped(client, PERMIT);
  assert.equal(sig.fieldsShown, true);
  assert.equal(recovered, device.addressFor(PATH));
  const record = device.signRecords.at(-1)!;
  assert.equal(record.schema, LatticeSignSchema.ETH_MSG);
  const shown = record.typedData as { message: { details: { amount: bigint }; spender: string } };
  assert.equal(shown.message.details.amount, 1000000n);
  assert.equal(shown.message.spender, "0x2222222222222222222222222222222222222222");
});

test("EIP-712 fields for a Safe transaction built with bigint values, as the Safe owner flow does", async () => {
  const { device, client } = setup();
  await client.connect();
  const safeTx: TypedInput = {
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
    domain: { chainId: 1n, verifyingContract: "0x5aFE3855358E112B5647B952709E6165e1c1eEEe" },
    message: {
      to: TO,
      value: 10n ** 18n,
      data: "0x00",
      operation: 0,
      safeTxGas: 0n,
      baseGas: 0n,
      gasPrice: 0n,
      gasToken: "0x0000000000000000000000000000000000000000",
      refundReceiver: "0x0000000000000000000000000000000000000000",
      nonce: 7n,
    },
  };
  const { sig, recovered } = await signTyped(client, safeTx);
  assert.equal(sig.fieldsShown, true);
  assert.equal(recovered, device.addressFor(PATH));
  // The SDK would send `data: 0x00` as empty bytes; the device must get the real byte.
  assert.equal((device.signRecords.at(-1)!.typedData as { message: { data: string } }).message.data, "0x00");
});

test("EIP-712 arrays of structs and a 2,000-character string (one extra frame) show as fields", async () => {
  const { device, client } = setup();
  await client.connect();
  const mail: TypedInput = {
    types: {
      EIP712Domain: DOMAIN_FIELDS,
      Person: [{ name: "name", type: "string" }, { name: "wallets", type: "address[]" }],
      Mail: [{ name: "from", type: "Person" }, { name: "to", type: "Person[]" }, { name: "contents", type: "string" }],
    },
    primaryType: "Mail",
    domain: { name: "Ether Mail", chainId: 1, verifyingContract: TO },
    message: { from: { name: "Cow", wallets: [TO] }, to: [{ name: "Bob", wallets: [TO, TO] }], contents: "x".repeat(2000) },
  };
  const { sig, recovered } = await signTyped(client, mail);
  assert.equal(sig.fieldsShown, true);
  assert.equal(recovered, device.addressFor(PATH));
  assert.equal(device.signRecords.at(-1)!.extraFrames, 1);
});

test("EIP-712 with nested arrays falls back to hashes without asking the device to parse it", async () => {
  const { device, client } = setup();
  await client.connect();
  const grid: TypedInput = {
    types: { EIP712Domain: DOMAIN_FIELDS, Grid: [{ name: "cells", type: "uint256[][]" }] },
    primaryType: "Grid",
    domain: { name: "Grid", chainId: 1, verifyingContract: TO },
    message: { cells: [[1n, 2n], [3n]] },
  };
  const { sig, recovered } = await signTyped(client, grid);
  assert.equal(sig.fieldsShown, false);
  assert.equal(recovered, device.addressFor(PATH));
  assert.deepEqual(device.signRecords.map((r) => r.schema), [LatticeSignSchema.GENERIC]);
});

test("EIP-712 with more than 36 fields in a type falls back to hashes", async () => {
  const { client } = setup();
  await client.connect();
  const wide: TypedInput = {
    types: { EIP712Domain: DOMAIN_FIELDS, Wide: Array.from({ length: 37 }, (_, i) => ({ name: `f${i}`, type: "uint256" })) },
    primaryType: "Wide",
    domain: { name: "Wide", chainId: 1, verifyingContract: TO },
    message: Object.fromEntries(Array.from({ length: 37 }, (_, i) => [`f${i}`, BigInt(i)])),
  };
  const { sig } = await signTyped(client, wide);
  assert.equal(sig.fieldsShown, false);
});

test("EIP-712 falls back to hashes when the device rejects the typed-data request format", async () => {
  const { device, client } = setup({ rejectTypedData: true });
  await client.connect();
  const { sig, recovered } = await signTyped(client, PERMIT);
  assert.equal(sig.fieldsShown, false);
  assert.equal(recovered, device.addressFor(PATH));
  assert.deepEqual(device.signRecords.map((r) => r.schema), [LatticeSignSchema.GENERIC]);
});

test("a user rejection of EIP-712 fields does not fall back to a second prompt", async () => {
  const { device, client } = setup();
  await client.connect();
  device.queueError(LatticeResponseCode.USER_DECLINED);
  await assert.rejects(
    signTyped(client, PERMIT),
    (err: unknown) => err instanceof LatticeProtocolError && err.responseCode === LatticeResponseCode.USER_DECLINED,
  );
  assert.equal(device.signRecords.length, 0);
});

test("a device digest that differs from the reviewed payload is rejected", async () => {
  const { client } = setup({ forgedDigest: hexToBytes(keccak256("0x01")) });
  await client.connect();
  await assert.rejects(
    signLatticeTypedDataHashes(client, { signerPath: PATH, domainSeparator: keccak256("0x02"), messageHash: keccak256("0x03") }),
    /different digest/,
  );
});

test("firmware that omits the digest still recovers against the local digest", async () => {
  const { device, client } = setup({ omitDigest: true });
  await client.connect();
  const sig = await signLatticeTypedDataHashes(client, { signerPath: PATH, domainSeparator: keccak256("0x09") });
  assert.equal(sig.signer, device.addressFor(PATH));
});

test("INVALID_EPHEM_ID triggers one reconnect and a retry", async () => {
  const { device, client } = setup();
  await client.connect();
  device.desync();
  const before = device.connectCount;
  const addresses = await client.getAddresses({ startPath: PATH, n: 1 });
  assert.equal(addresses.length, 1);
  assert.equal(device.connectCount, before + 1);
});

test("DEVICE_BUSY waits three seconds and retries", async () => {
  const { device, client, sleeps } = setup();
  await client.connect();
  device.queueError(LatticeResponseCode.DEVICE_BUSY);
  await client.getAddresses({ startPath: PATH, n: 1 });
  assert.deepEqual(sleeps, [3000]);
});

test("a user rejection surfaces as USER_DECLINED without retry", async () => {
  const { device, client } = setup();
  await client.connect();
  device.queueError(LatticeResponseCode.USER_DECLINED);
  const requestsBefore = device.requestCount;
  await assert.rejects(
    signLatticePersonalMessage(client, { signerPath: PATH, message: new Uint8Array([1]) }),
    (err: unknown) => err instanceof LatticeProtocolError && err.responseCode === LatticeResponseCode.USER_DECLINED,
  );
  assert.equal(device.requestCount, requestsBefore + 1);
});

test("SafeCard swap after connect fails with WRONG_WALLET", async () => {
  const { device, client } = setup();
  await client.connect();
  device.setSafeCard(true);
  await assert.rejects(
    client.getAddresses({ startPath: PATH, n: 1 }),
    (err: unknown) => err instanceof LatticeProtocolError && err.responseCode === LatticeResponseCode.WRONG_WALLET,
  );
});

test("an aborted signal stops before sending", async () => {
  const { device, client } = setup();
  await client.connect();
  const controller = new AbortController();
  controller.abort();
  const before = device.requestCount;
  await assert.rejects(client.getAddresses({ startPath: PATH, n: 1, signal: controller.signal }), /cancelled/);
  assert.equal(device.requestCount, before);
});

test("signer recovery matches the device key in compressed or uncompressed form", async () => {
  const privateKey = generatePrivateKey();
  const digest = hexToBytes(keccak256("0x1234"));
  const sig = await sign({ hash: keccak256("0x1234"), privateKey });
  const uncompressed = hexToBytes(privateKeyToAccount(privateKey).publicKey);
  const compressed = Uint8Array.of(uncompressed[64] & 1 ? 0x03 : 0x02, ...uncompressed.subarray(1, 33));
  const [r, s] = [hexToBytes(sig.r), hexToBytes(sig.s)];
  for (const reported of [uncompressed, compressed]) {
    const recovered = await recoverLatticeSigner(digest, r, s, reported);
    assert.equal(recovered.yParity, sig.yParity);
    assert.equal(recovered.publicKey, privateKeyToAccount(privateKey).publicKey);
  }
  const other = hexToBytes(privateKeyToAccount(generatePrivateKey()).publicKey);
  await assert.rejects(recoverLatticeSigner(digest, r, s, other), /y-parity/);
});
