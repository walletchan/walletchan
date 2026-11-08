/**
 * ETH_MSG personal_sign request layout, checked against gridplus-sdk 4.0.0
 * `buildPersonalSignRequest` and `getExtraData` (dist/index.mjs) for firmware
 * >= 0.15: 1,540 message bytes in the base frame, one 1,500-byte extra frame,
 * a 72-byte header allowance, so messages above 2,968 bytes are prehashed.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { bytesToHex, hashMessage, hexToBytes } from "viem";
import { generatePrivateKey, sign } from "viem/accounts";

import { encodeDerSignature, encodePersonalSignRequest, latticeSignerPath, parseEthMsgSignResponse } from "./protocolImports";

const PATH = latticeSignerPath("m/44'/60'/0'/0/7");

function u32le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

/** protocol(1)=0 | pathLen(4 LE) | 5 x index(4 LE) | displayHex(1) | msgLen(2 LE) */
function expectedHeader(displayHex: boolean, length: number): number[] {
  const indices = [...PATH, ...Array(5 - PATH.length).fill(0)];
  return [0, ...u32le(PATH.length), ...indices.flatMap(u32le), displayHex ? 1 : 0, length & 0xff, length >> 8];
}

test("an ASCII message is sent bare, with the text-display flag", () => {
  const message = new TextEncoder().encode("hi");
  const request = encodePersonalSignRequest({ signerPath: PATH, message });
  assert.deepEqual(Array.from(request.base), [...expectedHeader(false, 2), 0x68, 0x69]);
  assert.deepEqual(request.extraPayloads, []);
  assert.equal(request.prehashed, false);
});

test("display flag follows the SDK's ASCII rule, including the empty message", () => {
  const flag = (bytes: number[]) => encodePersonalSignRequest({ signerPath: PATH, message: Uint8Array.from(bytes) }).displayHex;
  assert.equal(flag([0x00, 0x0a, 0x7f]), false);
  assert.equal(flag([0x41, 0x80]), true);
  assert.equal(flag([0xe2, 0x9c, 0x93]), true);
  assert.equal(flag([]), true);
});

test("2,968 bytes is the largest message sent in full: base frame plus one extra frame", () => {
  const message = Uint8Array.from({ length: 2968 }, (_, i) => 0x20 + (i % 90));
  const request = encodePersonalSignRequest({ signerPath: PATH, message });
  assert.equal(request.prehashed, false);
  assert.deepEqual(Array.from(request.base.subarray(0, 28)), expectedHeader(false, 2968));
  assert.deepEqual(request.base.subarray(28), message.subarray(0, 1540));
  assert.equal(request.extraPayloads.length, 1);
  assert.deepEqual(Array.from(request.extraPayloads[0].subarray(0, 4)), u32le(1428));
  assert.deepEqual(request.extraPayloads[0].subarray(4), message.subarray(1540));
});

test("2,969 bytes is prehashed: the base frame carries the EIP-191 digest and the full length", () => {
  const message = Uint8Array.from({ length: 2969 }, () => 0x61);
  const request = encodePersonalSignRequest({ signerPath: PATH, message });
  assert.equal(request.prehashed, true);
  assert.deepEqual(request.extraPayloads, []);
  assert.deepEqual(Array.from(request.base), [...expectedHeader(false, 2969), ...hexToBytes(hashMessage({ raw: message }))]);
});

test("messages longer than a u16 length are refused", () => {
  assert.throws(() => encodePersonalSignRequest({ signerPath: PATH, message: new Uint8Array(0x10000) }), /too large/);
});

test("the reply parser reads the DER signature slot and the 20-byte signer", async () => {
  const sig = await sign({ hash: hashMessage("reply"), privateKey: generatePrivateKey() });
  const signer = Uint8Array.from({ length: 20 }, (_, i) => i + 1);
  const reply = new Uint8Array(1090);
  reply.set(encodeDerSignature(hexToBytes(sig.r), hexToBytes(sig.s)), 0);
  reply.set(signer, 74);
  const parsed = parseEthMsgSignResponse(reply);
  assert.equal(bytesToHex(parsed.r), sig.r);
  assert.equal(bytesToHex(parsed.s), sig.s);
  assert.deepEqual(parsed.signer, signer);
});
