/** End-to-end protocol client behaviour against the in-process Lattice simulator. */
import assert from "node:assert/strict";
import test from "node:test";

import {
  encodeFunctionData,
  erc20Abi,
  hashDomain,
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

import { FakeLattice } from "./fakeLattice";
import {
  LatticeProtocolClient,
  LatticeProtocolError,
  LatticeResponseCode,
  encodeEvmDecoder,
  evmTransactionPayload,
  generateLatticeAppPrivateKey,
  latticeSignerPath,
  signLatticePersonalMessage,
  signLatticeTransaction,
  signLatticeTypedDataHashes,
} from "./protocolImports";

const PATH = latticeSignerPath("m/44'/60'/0'/0/0");
const TO = "0x000000000000000000000000000000000000dEaD" as Address;

function setup(options: ConstructorParameters<typeof FakeLattice>[0] = {}) {
  const device = new FakeLattice(options);
  const sleeps: number[] = [];
  const client = new LatticeProtocolClient({
    appPrivateKey: generateLatticeAppPrivateKey(),
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

test("personal_sign recovers with viem", async () => {
  const { device, client } = setup();
  await client.connect();
  const message = new TextEncoder().encode("Sign in to WalletChan");
  const sig = await signLatticePersonalMessage(client, { signerPath: PATH, message });
  const signature = serializeSignature({ r: sig.r, s: sig.s, yParity: sig.yParity });
  assert.equal(await recoverMessageAddress({ message: { raw: message }, signature }), device.addressFor(PATH));
  assert.equal(device.signRecords.at(-1)!.encoding, 1);
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

test("a device digest that differs from the reviewed payload is rejected", async () => {
  const { client } = setup({ forgedDigest: hexToBytes(keccak256("0x01")) });
  await client.connect();
  await assert.rejects(
    signLatticePersonalMessage(client, { signerPath: PATH, message: new Uint8Array([1, 2, 3]) }),
    /different digest/,
  );
});

test("firmware that omits the digest still recovers against the local digest", async () => {
  const { device, client } = setup({ omitDigest: true });
  await client.connect();
  const sig = await signLatticePersonalMessage(client, { signerPath: PATH, message: new Uint8Array([9]) });
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
