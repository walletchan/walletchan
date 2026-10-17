import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeMessageHex,
  normalizeOptionalHash,
  unwrapTrezorResponse,
  validateAddressPage,
  validateDeviceFeatures,
  validateDeviceIdentity,
  validateReturnedSignature,
  validateSignedTransaction,
  validateTransaction,
} from "../../src/chrome/trezor/connectValidation";

const address = "0x1111111111111111111111111111111111111111";

test("Trezor device metadata comes from a bounded Ethereum-capable feature response", () => {
  assert.deepEqual(
    validateDeviceFeatures({
      label: "My Trezor",
      model: "T",
      internal_model: "T2T1",
      capabilities: ["Capability_Bitcoin", "Capability_Ethereum"],
    }),
    { label: "My Trezor", model: "T2T1" },
  );
  assert.deepEqual(
    validateDeviceFeatures({
      label: null,
      model: "1",
      capabilities: ["Capability_Ethereum"],
    }),
    { label: "Trezor", model: "1" },
  );
  assert.throws(
    () =>
      validateDeviceFeatures({
        label: "Bitcoin only",
        model: "1",
        capabilities: ["Capability_Bitcoin"],
      }),
    /does not report Ethereum support/,
  );
  assert.throws(() =>
    validateDeviceFeatures({
      label: "unsafe\u0000label",
      model: "1",
      capabilities: ["Capability_Ethereum"],
    }),
  );
});

test("Trezor address responses remain pinned to the requested path row", () => {
  assert.deepEqual(
    validateAddressPage(
      [
        {
          address,
          serializedPath: "m/44'/60'/0'/0/4",
        },
      ],
      [{ hdPath: "m/44'/60'/0'/0/4", hdIndex: 4 }],
    ),
    [
      {
        address,
        hdPath: "m/44'/60'/0'/0/4",
        hdIndex: 4,
      },
    ],
  );
  assert.throws(() =>
    validateAddressPage(
      [
        {
          address,
          serializedPath: "m/44'/60'/0'/0/5",
        },
      ],
      [{ hdPath: "m/44'/60'/0'/0/4", hdIndex: 4 }],
    ),
  );
  assert.equal(
    validateDeviceIdentity(`0x${address.slice(2).toUpperCase()}`),
    address,
  );
});

test("Trezor transaction validation accepts only bounded legacy or EIP-1559 fields", () => {
  assert.doesNotThrow(() =>
    validateTransaction({
      to: address,
      value: "0x0",
      gasPrice: "0x1",
      gasLimit: "0x5208",
      nonce: "0x0",
      data: "0x",
      chainId: 1,
    }),
  );
  assert.doesNotThrow(() =>
    validateTransaction({
      to: null,
      value: "0x0",
      gasLimit: "0x5208",
      nonce: "0x0",
      data: "0x1234",
      chainId: 8453,
      maxFeePerGas: "0x2",
      maxPriorityFeePerGas: "0x1",
      accessList: [
        {
          address,
          storageKeys: [`0x${"00".repeat(32)}`],
        },
      ],
    }),
  );
  assert.throws(() =>
    validateTransaction({
      to: address,
      value: "0x00",
      gasPrice: "0x1",
      gasLimit: "0x5208",
      nonce: "0x0",
      chainId: 1,
    }),
  );
  assert.throws(() =>
    validateTransaction({
      to: address,
      value: "0x0",
      gasLimit: "0x5208",
      nonce: "0x0",
      chainId: 1,
      maxFeePerGas: "0x2",
      maxPriorityFeePerGas: "0x1",
      accessList: [{ address, storageKeys: ["0x01"] }],
    }),
  );
});

test("Trezor message and typed-data hashes use exact validated bytes", () => {
  assert.equal(normalizeMessageHex("0x1234"), "1234");
  assert.equal(normalizeMessageHex(""), "");
  assert.throws(() => normalizeMessageHex("0x123"));
  assert.throws(() => normalizeMessageHex("not-hex"));
  assert.equal(
    normalizeOptionalHash(`0x${"ab".repeat(32)}`),
    "ab".repeat(32),
  );
  assert.throws(() => normalizeOptionalHash("0x12"));
});

test("Trezor signature responses are bounded and normalized", () => {
  assert.deepEqual(
    validateReturnedSignature({
      address,
      signature: "11".repeat(65),
    }),
    {
      address,
      signature: `0x${"11".repeat(65)}`,
    },
  );
  assert.throws(() =>
    validateReturnedSignature({
      address,
      signature: "11".repeat(64),
    }),
  );
  assert.deepEqual(
    validateSignedTransaction({
      v: "0x1b",
      r: `0x${"11".repeat(32)}`,
      s: `0x${"22".repeat(32)}`,
      serializedTx: "0x1234",
    }),
    {
      v: "0x1b",
      r: `0x${"11".repeat(32)}`,
      s: `0x${"22".repeat(32)}`,
      serializedTx: "0x1234",
    },
  );
  for (const v of ["0x0", "0x1"]) {
    assert.equal(
      validateSignedTransaction({
        v,
        r: `0x${"11".repeat(32)}`,
        s: `0x${"22".repeat(32)}`,
        serializedTx: "0x02",
      }).v,
      v,
    );
  }
  assert.throws(() =>
    validateSignedTransaction({
      v: "0x01",
      r: `0x${"11".repeat(32)}`,
      s: `0x${"22".repeat(32)}`,
      serializedTx: "0x1234",
    }),
  );
});

test("Trezor SDK failures stay failures at the response boundary", () => {
  assert.deepEqual(
    unwrapTrezorResponse({
      success: true as const,
      payload: { address },
    }),
    { address },
  );
  assert.throws(
    () =>
      unwrapTrezorResponse({
        success: false as const,
        payload: {
          code: "Failure_ActionCancelled",
          error: "cancelled",
        },
      }),
    (error) =>
      (error as { code?: string }).code === "Failure_ActionCancelled",
  );
});
