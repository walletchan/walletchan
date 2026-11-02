/** Calldata decoder bytes match the ape-grid-lattice fixtures (gridplus-sdk algorithm). */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { bytesToHex } from "viem";

import { LatticeDecoderUnsupportedError, encodeEvmDecoder, functionSelector } from "./protocolImports";

const fx = JSON.parse(readFileSync(new URL("./fixtures/apeGridParity.json", import.meta.url), "utf8"));
const h = (bytes: Uint8Array) => bytesToHex(bytes).slice(2);

test("transfer, approve, array and mixed basic-type decoders match", () => {
  assert.equal(h(encodeEvmDecoder("transfer(address,uint256)")), fx.decoder_transfer_hex);
  assert.equal(h(encodeEvmDecoder("approve(address,uint256)")), fx.decoder_approve_hex);
  assert.equal(
    h(encodeEvmDecoder("swapExactTokensForTokens(uint256,uint256,address[],address,uint256)")),
    fx.decoder_swap_hex,
  );
  assert.equal(h(encodeEvmDecoder("foo(bytes32,bool,int128)")), fx.decoder_bytes32_hex);
});

test("function selector", () => {
  assert.equal(h(functionSelector("transfer(address,uint256)")), "a9059cbb");
});

test("tuples are refused until the parity work adds them", () => {
  assert.throws(() => encodeEvmDecoder("foo((uint256,address))"), LatticeDecoderUnsupportedError);
});

test("malformed types are refused", () => {
  assert.throws(() => encodeEvmDecoder("foo(uint7)"));
  assert.throws(() => encodeEvmDecoder("foo(bytes33)"));
  assert.throws(() => encodeEvmDecoder("foo(widget)"));
  assert.throws(() => encodeEvmDecoder("foo(address"));
});
