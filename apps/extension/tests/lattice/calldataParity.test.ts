/**
 * Calldata decoder bytes match the ape-grid-lattice fixtures for basic types.
 * The real gridplus-sdk is the authority (sdkParity.test.ts); ape_grid sizes
 * bytesN as N bytes where the SDK uses N / 8, so that case lives there.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { bytesToHex } from "viem";

import { LatticeDecoderUnsupportedError, encodeEvmDecoder, functionSelector } from "./protocolImports";

const fx = JSON.parse(readFileSync(new URL("./fixtures/apeGridParity.json", import.meta.url), "utf8"));
const h = (bytes: Uint8Array) => bytesToHex(bytes).slice(2);

test("transfer, approve and array decoders match", () => {
  assert.equal(h(encodeEvmDecoder("transfer(address,uint256)")), fx.decoder_transfer_hex);
  assert.equal(h(encodeEvmDecoder("approve(address,uint256)")), fx.decoder_approve_hex);
  assert.equal(
    h(encodeEvmDecoder("swapExactTokensForTokens(uint256,uint256,address[],address,uint256)")),
    fx.decoder_swap_hex,
  );
});

test("function selector", () => {
  assert.equal(h(functionSelector("transfer(address,uint256)")), "a9059cbb");
});

test("sizes the SDK cannot express and malformed signatures are refused", () => {
  for (const signature of ["foo(bytes4)", "foo(uint7)", "foo(bytes33)", "foo(widget)", "foo(address", "foo(uint256[x])", "foo((uint256)"]) {
    assert.throws(() => encodeEvmDecoder(signature), LatticeDecoderUnsupportedError, signature);
  }
});
