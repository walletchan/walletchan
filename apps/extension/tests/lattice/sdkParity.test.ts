/**
 * Byte parity with gridplus-sdk for ETH_MSG requests. The fixtures are the
 * exact sign envelopes the real SDK `Client` sent to the simulator; regenerate
 * them with tools/lattice-sdk-parity (see its README).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { bytesToHex, hexToBytes } from "viem";

import { encodePersonalSignRequest, encodeSignEnvelope, encodeTypedDataRequest, LatticeSignSchema } from "./protocolImports";

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
