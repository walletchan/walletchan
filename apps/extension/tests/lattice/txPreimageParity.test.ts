/** Unsigned transaction bytes from viem match the ape-grid-lattice RLP fixtures. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { bytesToHex, zeroAddress, type Address } from "viem";

import { evmTransactionPayload } from "./protocolImports";

const fx = JSON.parse(readFileSync(new URL("./fixtures/apeGridParity.json", import.meta.url), "utf8"));
const h = (bytes: Uint8Array) => bytesToHex(bytes).slice(2);

test("legacy EIP-155 preimage", () => {
  const payload = evmTransactionPayload({
    type: "legacy",
    to: fx.tx_to as Address,
    value: 0n,
    gas: 21000n,
    gasPrice: 1_000_000_000n,
    nonce: 0,
    chainId: 1,
  });
  assert.equal(h(payload), fx.legacy_preimage_hex);
});

test("EIP-2930 preimage", () => {
  const payload = evmTransactionPayload({
    type: "eip2930",
    to: fx.tx_to as Address,
    value: 0n,
    gas: 21000n,
    gasPrice: 1_000_000_000n,
    nonce: 0,
    chainId: 1,
    accessList: [
      {
        address: fx.acl_address as Address,
        storageKeys: [`0x${"00".repeat(32)}`, `0x${"00".repeat(31)}01`],
      },
    ],
  });
  assert.equal(h(payload), fx.acl_2930_preimage_hex);
});

test("EIP-1559 preimage", () => {
  const payload = evmTransactionPayload({
    type: "eip1559",
    to: fx.tx_to as Address,
    value: 0n,
    gas: 21000n,
    maxFeePerGas: 2_000_000_000n,
    maxPriorityFeePerGas: 1_000_000_000n,
    nonce: 0,
    chainId: 1,
    accessList: [],
  });
  assert.equal(h(payload), fx.dyn_fee_preimage_hex);
});

test("EIP-7702 preimage", () => {
  const payload = evmTransactionPayload({
    type: "eip7702",
    to: zeroAddress,
    value: 0n,
    gas: 21000n,
    maxFeePerGas: 2_000_000_000n,
    maxPriorityFeePerGas: 1_000_000_000n,
    nonce: 0,
    chainId: 1,
    accessList: [],
    authorizationList: [
      { chainId: 1, address: fx.set_code_auth_address as Address, nonce: 0, yParity: 0, r: "0x1", s: "0x1" },
    ],
  });
  assert.equal(h(payload), fx.set_code_preimage_hex);
});
