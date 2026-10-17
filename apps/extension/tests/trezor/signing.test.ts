import assert from "node:assert/strict";
import test from "node:test";
import {
  hashTypedData,
  hashDomain,
  hashStruct,
  getTypesForEIP712Domain,
  parseTransaction,
  toHex,
  type TransactionSerializable,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { TrezorAccount } from "../../src/chrome/types";
import {
  buildTrezorTransactionPayload,
  signTrezorTypedDataForAccount,
  verifyTrezorMessageSignature,
  verifyTrezorSignedTransaction,
  verifyTrezorTypedDataSignature,
} from "../../src/chrome/trezor/signing";
import { trezorConnectAdapter } from "../../src/chrome/trezor/connectSdk";
import { validateEIP712TypedData } from "../../src/chrome/eip712Validator";

const signer = privateKeyToAccount(
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
);
const otherSigner = privateKeyToAccount(
  "0x1123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
);
const account: TrezorAccount = {
  id: "trezor-account-1",
  type: "trezor",
  address: signer.address,
  deviceId: "0x0000000000000000000000000000000000000001",
  hdPath: "m/44'/60'/0'/0/0",
  hdIndex: 0,
  createdAt: 1,
};

test("Trezor signing normalizes omitted domain schemas and verifies the original digest", async (t) => {
  const originalChrome = Object.getOwnPropertyDescriptor(globalThis, "chrome");
  const originalSign = trezorConnectAdapter.signTrezorTypedData;
  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: { runtime: { sendMessage: async () => undefined } },
  });
  t.after(() => {
    trezorConnectAdapter.signTrezorTypedData = originalSign;
    if (originalChrome) {
      Object.defineProperty(globalThis, "chrome", originalChrome);
    }
    else Reflect.deleteProperty(globalThis, "chrome");
  });
  for (const explicitDomain of [false, true]) {
    const data = {
      types: {
        ...(explicitDomain ? {
          EIP712Domain: [
            { name: "chainId", type: "uint256" },
            { name: "name", type: "string" },
          ],
        } : {}),
        Mail: [{ name: "contents", type: "string" }],
      },
      primaryType: "Mail",
      domain: { name: "Example", chainId: 1 },
      message: { contents: "Hello" },
    };
    const original = structuredClone(data);
    assert.equal(
      validateEIP712TypedData("eth_signTypedData_v4", data).valid, true,
    );
    const types = {
      EIP712Domain: getTypesForEIP712Domain({ domain: data.domain }),
      ...data.types,
    };
    let calls = 0;
    let wrongSigner = false;
    trezorConnectAdapter.signTrezorTypedData = async (_device, _path, payload, domainHash, messageHash) => {
      calls++;
      assert.deepEqual(payload, { ...data, types });
      assert.equal(domainHash, hashDomain({ domain: data.domain, types }));
      assert.equal(messageHash, hashStruct({
        data: data.message, primaryType: data.primaryType, types,
      }));
      return {
        address: account.address,
        signature: await (wrongSigner ? otherSigner : signer).signTypedData(data),
      };
    };
    assert.equal(
      await signTrezorTypedDataForAccount({
        opId: "domain-schema", account, typedData: data, chainId: 1,
      }),
      await signer.signTypedData(data),
    );
    wrongSigner = true;
    await assert.rejects(
      signTrezorTypedDataForAccount({
        opId: "wrong-signer", account, typedData: data, chainId: 1,
      }),
      /different account/,
    );
    assert.equal(calls, 2);
    assert.deepEqual(data, original);
  }
});

function sdkResult(serializedTx: `0x${string}`) {
  const parsed = parseTransaction(serializedTx);
  assert.ok(parsed.r);
  assert.ok(parsed.s);
  return {
    r: parsed.r,
    s: parsed.s,
    v: toHex(parsed.v ?? BigInt(parsed.yParity ?? 0)),
    serializedTx,
  };
}

test("Trezor legacy payloads retain the exact reviewed unsigned fields", () => {
  const transaction = {
    type: "legacy",
    chainId: 1,
    to: otherSigner.address,
    value: 25n,
    gas: 21_000n,
    gasPrice: 3_000_000_000n,
    nonce: 7,
    data: "0x",
  } satisfies TransactionSerializable;
  assert.deepEqual(buildTrezorTransactionPayload(transaction, 1), {
    to: otherSigner.address,
    value: "0x19",
    gasLimit: "0x5208",
    nonce: "0x7",
    data: "0x",
    chainId: 1,
    gasPrice: "0xb2d05e00",
  });
});

test("Trezor EIP-1559 payloads preserve access lists and reject EIP-2930-only requests", () => {
  const accessList = [
    {
      address: otherSigner.address,
      storageKeys: [`0x${"00".repeat(32)}` as `0x${string}`],
    },
  ];
  const transaction = {
    type: "eip1559",
    chainId: 8453,
    to: otherSigner.address,
    value: 0n,
    gas: 55_000n,
    maxFeePerGas: 2_000_000_000n,
    maxPriorityFeePerGas: 1_000_000_000n,
    nonce: 9,
    data: "0x1234",
    accessList,
  } satisfies TransactionSerializable;
  assert.deepEqual(buildTrezorTransactionPayload(transaction, 8453), {
    to: otherSigner.address,
    value: "0x0",
    gasLimit: "0xd6d8",
    nonce: "0x9",
    data: "0x1234",
    chainId: 8453,
    maxFeePerGas: "0x77359400",
    maxPriorityFeePerGas: "0x3b9aca00",
    accessList,
  });
  assert.throws(
    () =>
      buildTrezorTransactionPayload(
        {
          ...transaction,
          type: "eip2930",
          gasPrice: 1n,
          maxFeePerGas: undefined,
          maxPriorityFeePerGas: undefined,
        } as TransactionSerializable,
        8453,
      ),
    /EIP-2930-only transactions are not supported/,
  );
});

test("Trezor transaction verification requires exact serialized bytes and the pinned signer", async () => {
  const transaction = {
    type: "eip1559",
    chainId: 1,
    to: otherSigner.address,
    value: 42n,
    gas: 50_000n,
    maxFeePerGas: 2_000_000_000n,
    maxPriorityFeePerGas: 1_000_000_000n,
    nonce: 3,
    data: "0x1234",
  } satisfies TransactionSerializable;
  const serializedTx = await signer.signTransaction(transaction);
  assert.equal(
    await verifyTrezorSignedTransaction({
      account,
      transaction,
      result: sdkResult(serializedTx),
      chainId: 1,
    }),
    serializedTx,
  );

  await assert.rejects(
    verifyTrezorSignedTransaction({
      account,
      transaction: { ...transaction, value: 43n },
      result: sdkResult(serializedTx),
      chainId: 1,
    }),
    /do not match the reviewed request/,
  );
  await assert.rejects(
    verifyTrezorSignedTransaction({
      account: { ...account, address: otherSigner.address },
      transaction,
      result: sdkResult(serializedTx),
      chainId: 1,
    }),
    /different account/,
  );
});

test("Trezor personal-message verification binds returned and recovered addresses to exact bytes", async () => {
  const messageHex = "0x000102ff" as const;
  const signature = await signer.signMessage({ message: { raw: messageHex } });
  assert.equal(
    await verifyTrezorMessageSignature({
      account,
      address: signer.address,
      signature,
      messageHex,
    }),
    signature,
  );
  await assert.rejects(
    verifyTrezorMessageSignature({
      account,
      address: otherSigner.address,
      signature,
      messageHex,
    }),
    /different account/,
  );
  await assert.rejects(
    verifyTrezorMessageSignature({
      account,
      address: signer.address,
      signature,
      messageHex: "0x000102fe",
    }),
    /different account/,
  );
});

test("Trezor typed-data verification uses the locally computed reviewed digest", async () => {
  const typedData = {
    domain: {
      name: "WalletChan test",
      version: "1",
      chainId: 1,
      verifyingContract: otherSigner.address,
    },
    types: {
      Mail: [
        { name: "from", type: "address" },
        { name: "contents", type: "string" },
      ],
    },
    primaryType: "Mail",
    message: {
      from: signer.address,
      contents: "Approve exactly this",
    },
  } as const;
  const signature = await signer.signTypedData(typedData);
  const expectedDigest = hashTypedData(typedData);
  assert.equal(
    await verifyTrezorTypedDataSignature({
      account,
      address: signer.address,
      signature,
      expectedDigest,
    }),
    signature,
  );
  await assert.rejects(
    verifyTrezorTypedDataSignature({
      account,
      address: signer.address,
      signature,
      expectedDigest: `0x${"11".repeat(32)}`,
    }),
    /different account/,
  );
});

test("direct signing rejects another wallet even when response metadata claims the pinned address", async () => {
  const messageHex = "0x1234" as const;
  await assert.rejects(
    verifyTrezorMessageSignature({
      account,
      address: account.address,
      messageHex,
      signature: await otherSigner.signMessage({
        message: { raw: messageHex },
      }),
    }),
    /different account/,
  );
  const typedData = {
    domain: { name: "Direct signing regression", chainId: 1 },
    types: { Test: [{ name: "value", type: "uint256" }] },
    primaryType: "Test",
    message: { value: 1n },
  } as const;
  await assert.rejects(
    verifyTrezorTypedDataSignature({
      account,
      address: account.address,
      expectedDigest: hashTypedData(typedData),
      signature: await otherSigner.signTypedData(typedData),
    }),
    /different account/,
  );
});
