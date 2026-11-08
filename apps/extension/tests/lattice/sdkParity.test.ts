/**
 * Byte parity with gridplus-sdk for ETH_MSG requests. The fixtures are the
 * exact sign envelopes the real SDK `Client` sent to the simulator; regenerate
 * them with tools/lattice-sdk-parity (see its README).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { bytesToHex, hexToBytes } from "viem";

import {
  encodeEvmDecoder,
  encodeEvmDecoderForFunction,
  encodePersonalSignRequest,
  encodeSignEnvelope,
  encodeTypedDataRequest,
  functionSelector,
  LatticeDecoderUnsupportedError,
  LatticeSignSchema,
} from "./protocolImports";

interface SdkCase {
  name: string;
  protocol: "signPersonal" | "eip712";
  payload: unknown;
  envelope: `0x${string}`;
  envelopeSize: number;
  extras: `0x${string}`[];
}

const fixtures = JSON.parse(readFileSync(new URL("./fixtures/gridplusSdkEthMsg.json", import.meta.url), "utf8")) as {
  source: string;
  signerPath: number[];
  walletUid: `0x${string}`;
  cases: SdkCase[];
  decoders: Array<{ signature: string; selector: `0x${string}`; def: `0x${string}` }>;
  abiDecoders: Array<{ signature: string; selector: `0x${string}`; abi: unknown; def: `0x${string}` }>;
};

function padded(hex: `0x${string}`, size: number): `0x${string}` {
  const out = new Uint8Array(size);
  out.set(hexToBytes(hex));
  return bytesToHex(out);
}

for (const fixture of fixtures.cases.filter((item) => item.protocol === "signPersonal")) {
  test(`personal_sign matches gridplus-sdk byte for byte: ${fixture.name}`, () => {
    const request = encodePersonalSignRequest({
      signerPath: fixtures.signerPath,
      message: hexToBytes(fixture.payload as `0x${string}`),
    });
    const envelope = encodeSignEnvelope({
      schema: LatticeSignSchema.ETH_MSG,
      walletUid: hexToBytes(fixtures.walletUid),
      reqPayload: request.base,
      hasExtraPayloads: request.extraPayloads.length > 0,
    });
    assert.equal(bytesToHex(envelope), padded(fixture.envelope, fixture.envelopeSize));
    assert.deepEqual(request.extraPayloads.map((frame) => bytesToHex(frame)), fixture.extras);
  });
}

for (const decoder of fixtures.decoders) {
  // The SDK sizes bytes32 as 4 and the device then showed only its last 4
  // bytes; size 32 was refused. Fixed bytesN functions therefore get no decoder.
  const fixedBytes = /bytes\d/.test(decoder.signature);
  test(`calldata decoder ${fixedBytes ? "is refused for fixed bytesN, unlike gridplus-sdk" : "matches gridplus-sdk byte for byte"}: ${decoder.signature}`, () => {
    assert.equal(bytesToHex(functionSelector(decoder.signature)), decoder.selector);
    if (fixedBytes) {
      assert.throws(() => encodeEvmDecoder(decoder.signature), LatticeDecoderUnsupportedError);
      return;
    }
    assert.equal(bytesToHex(encodeEvmDecoder(decoder.signature)), decoder.def);
  });
}

for (const decoder of fixtures.abiDecoders) {
  test(`named calldata decoder from a JSON ABI matches gridplus-sdk byte for byte: ${decoder.signature}`, () => {
    assert.equal(bytesToHex(functionSelector(decoder.signature)), decoder.selector);
    assert.equal(bytesToHex(encodeEvmDecoderForFunction(decoder.abi as never)), decoder.def);
  });
}

for (const fixture of fixtures.cases.filter((item) => item.protocol === "eip712")) {
  const prehashedBySdk = fixture.name.includes("prehashed");
  test(`EIP-712 ${prehashedBySdk ? "falls back to hashes where gridplus-sdk prehashes" : "matches gridplus-sdk byte for byte"}: ${fixture.name}`, () => {
    const request = encodeTypedDataRequest({
      signerPath: fixtures.signerPath,
      typedData: fixture.payload as Record<string, unknown>,
    });
    if (prehashedBySdk) {
      assert.equal(request, null);
      return;
    }
    assert.ok(request);
    const envelope = encodeSignEnvelope({
      schema: LatticeSignSchema.ETH_MSG,
      walletUid: hexToBytes(fixtures.walletUid),
      reqPayload: request.base,
      hasExtraPayloads: request.extraPayloads.length > 0,
    });
    assert.equal(bytesToHex(envelope), padded(fixture.envelope, fixture.envelopeSize));
    assert.deepEqual(request.extraPayloads.map((frame) => bytesToHex(frame)), fixture.extras);
  });
}
