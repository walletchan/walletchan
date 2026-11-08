/**
 * Byte parity with ape-grid-lattice fixtures, which its generate.js builds with
 * the same npm libraries gridplus-sdk uses (crc-32, aes-js, elliptic, rlp).
 */
import assert from "node:assert/strict";
import { createECDH, createPublicKey, verify as verifySignature } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { bytesToHex, hexToBytes, sha256 } from "viem";

import {
  LATTICE_APP_KEY_SIZE,
  LatticeEncryptedRequestType,
  assertUncompressedP256,
  buildConnectRequest,
  buildEncryptedRequest,
  buildSignerPathBuf,
  checkLatticeAppKey,
  concatBytes,
  crc32Lattice,
  encodeDerSignature,
  encodeGenericSigningRequest,
  encodeGetAddressesRequest,
  encodePairRequest,
  encodeSignEnvelope,
  generateLatticeAppKey,
  latticeAesDecrypt,
  latticeAesEncrypt,
  latticeAppPublicKey,
  latticeEphemeralId,
  latticeSharedSecret,
  latticeSignerPath,
  pairingNameBuffer,
  pairingPreimage,
  parseDerSignature,
  parseLatticeResponse,
} from "./protocolImports";

const fx = JSON.parse(readFileSync(new URL("./fixtures/apeGridParity.json", import.meta.url), "utf8"));
const b = (hex: string) => hexToBytes(`0x${hex}`);
const h = (bytes: Uint8Array) => bytesToHex(bytes).slice(2);

test("CRC-32 matches crc-32", () => {
  assert.equal(crc32Lattice(b(fx.crc_sample_hex)), fx.crc_sample_value);
});

const appKey = concatBytes(b(fx.app_priv_hex), b(fx.app_pub_uncompressed_hex));
const devKey = concatBytes(b(fx.dev_priv_hex), b(fx.dev_pub_uncompressed_hex));

/** OpenSSL ECDSA P-256 verification over sha256(message), for a DER signature. */
function opensslVerifies(pub: Uint8Array, message: Uint8Array, der: Uint8Array): boolean {
  const key = createPublicKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: Buffer.from(pub.subarray(1, 33)).toString("base64url"),
      y: Buffer.from(pub.subarray(33, 65)).toString("base64url"),
    },
    format: "jwk",
  });
  return verifySignature("sha256", message, { key, dsaEncoding: "der" }, der);
}

test("the app key carries the elliptic public key, and WebCrypto accepts the pair", async () => {
  assert.equal(h(latticeAppPublicKey(appKey)), fx.app_pub_uncompressed_hex);
  await checkLatticeAppKey(appKey);
  await checkLatticeAppKey(devKey);
  // A scalar stored with someone else's public key is refused.
  const mismatched = concatBytes(b(fx.app_priv_hex), b(fx.dev_pub_uncompressed_hex));
  await assert.rejects(checkLatticeAppKey(mismatched), /not a valid P-256 key pair/);
  assert.throws(() => latticeAppPublicKey(b(fx.app_priv_hex)), /65-byte public key/);
});

test("ECDH shared secret matches elliptic derive", async () => {
  assert.equal(h(await latticeSharedSecret(appKey, b(fx.dev_pub_uncompressed_hex))), fx.shared_secret_hex);
  // Symmetric from the device side too.
  assert.equal(h(await latticeSharedSecret(devKey, b(fx.app_pub_uncompressed_hex))), fx.shared_secret_hex);
});

test("device points off the curve are refused", async () => {
  await assertUncompressedP256(b(fx.dev_pub_uncompressed_hex));
  const offCurve = b(fx.dev_pub_uncompressed_hex);
  offCurve[64] ^= 1;
  await assert.rejects(assertUncompressedP256(offCurve), /uncompressed P-256 point/);
  await assert.rejects(latticeSharedSecret(appKey, offCurve), /uncompressed P-256 point/);
  await assert.rejects(assertUncompressedP256(b(fx.dev_pub_uncompressed_hex).slice(0, 64)), /uncompressed P-256 point/);
});

test("a generated app key agrees on ECDH with OpenSSL", async () => {
  const generated = await generateLatticeAppKey();
  assert.equal(generated.length, LATTICE_APP_KEY_SIZE);
  await checkLatticeAppKey(generated);
  const peer = createECDH("prime256v1");
  peer.generateKeys();
  const ours = await latticeSharedSecret(generated, new Uint8Array(peer.getPublicKey()));
  assert.equal(h(ours), peer.computeSecret(latticeAppPublicKey(generated)).toString("hex"));
});

test("AES-256-CBC with static IV matches aes-js, including PKCS7 for unaligned input", async () => {
  const key = b(fx.shared_secret_hex);
  const cipher = await latticeAesEncrypt(b(fx.aes_plain_hex), key);
  assert.equal(h(cipher), fx.aes_cipher_hex);
  const decrypted = await latticeAesDecrypt(cipher, key);
  const pad = decrypted[decrypted.length - 1];
  assert.equal(h(decrypted.slice(0, decrypted.length - pad)), fx.aes_plain_hex);
});

test("ephemeral ID matches getEphemeralId", () => {
  assert.equal(latticeEphemeralId(b(fx.shared_secret_hex)), fx.ephemeral_id);
});

test("pairing name buffer and digest match generateAppSecret", () => {
  const nameBuf = b(fx.pair_name_buf_hex);
  const end = nameBuf.indexOf(0);
  const appName = new TextDecoder().decode(nameBuf.subarray(0, end < 0 ? 25 : end));
  assert.equal(h(pairingNameBuffer(appName, fx.pair_secret)), fx.pair_name_buf_hex);
  assert.equal(h(pairingNameBuffer(appName, "")), "00".repeat(25));
  assert.equal(h(sha256(pairingPreimage(b(fx.app_pub_uncompressed_hex), nameBuf, fx.pair_secret), "bytes")), fx.pair_digest_hex);
  const manual = sha256(concatBytes(b(fx.app_pub_uncompressed_hex), nameBuf, new TextEncoder().encode(fx.pair_secret)), "bytes");
  assert.equal(h(manual), fx.pair_digest_hex);
});

test("the pairing signature verifies under the app key with OpenSSL", async () => {
  const nameBuf = b(fx.pair_name_buf_hex);
  const end = nameBuf.indexOf(0);
  const appName = new TextDecoder().decode(nameBuf.subarray(0, end < 0 ? 25 : end));
  const payload = await encodePairRequest(appKey, appName, fx.pair_secret);
  assert.equal(payload.length, 99);
  assert.equal(h(payload.subarray(0, 25)), fx.pair_name_buf_hex);
  const der = payload.subarray(25, 25 + 2 + payload[26]);
  assert.ok(payload.subarray(25 + der.length).every((byte) => byte === 0));
  const preimage = pairingPreimage(b(fx.app_pub_uncompressed_hex), nameBuf, fx.pair_secret);
  assert.ok(opensslVerifies(b(fx.app_pub_uncompressed_hex), preimage, der));
  assert.ok(!opensslVerifies(b(fx.dev_pub_uncompressed_hex), preimage, der));
});

test("connect frame matches serializeSecureRequestMsg", () => {
  assert.equal(h(buildConnectRequest(b(fx.app_pub_uncompressed_hex), b(fx.msg_id_hex))), fx.connect_frame_hex);
});

test("encrypted finalizePairing frame matches byte for byte", async () => {
  const frame = await buildEncryptedRequest(
    LatticeEncryptedRequestType.FINALIZE_PAIRING,
    new Uint8Array(99),
    b(fx.shared_secret_hex),
    b(fx.msg_id_hex),
  );
  assert.equal(h(frame), fx.encrypted_frame_zero_pair_hex);
});

test("getAddresses payload matches", () => {
  const payload = encodeGetAddressesRequest({
    walletUid: b(fx.wallet_uid_hex),
    startPath: [0x8000002c, 0x8000003c, 0x80000000, 0, 0],
    n: 1,
    flag: 0,
    iterIdx: 0,
  });
  assert.equal(h(payload), fx.get_addresses_payload_hex);
});

test("signer path buffer matches, and HD path parsing yields the fixture path", () => {
  assert.equal(h(buildSignerPathBuf(fx.signer_path)), fx.signer_path_buf_hex);
  assert.deepEqual(latticeSignerPath("m/44'/60'/0'/0/0"), fx.signer_path);
});

test("generic signing request (personal message) matches", () => {
  const req = encodeGenericSigningRequest({
    signerPath: fx.signer_path,
    payload: b(fx.personal_msg_hex),
    curve: 0,
    hashType: 1,
    encoding: 1,
  });
  assert.equal(h(req.base), fx.generic_signing_req_hex);
  assert.equal(req.extraPayloads.length, 0);
  assert.equal(req.prehashed, false);
});

test("2200-byte payload splits into base + one extra frame, matching JS", () => {
  const req = encodeGenericSigningRequest({
    signerPath: fx.signer_path,
    payload: b(fx.big_payload_hex),
    curve: 0,
    hashType: 1,
    encoding: 4,
  });
  assert.equal(h(req.base), fx.big_base_req_hex);
  assert.deepEqual(req.extraPayloads.map(h), fx.big_extra_payloads_hex);
});

test("sign envelope matches", () => {
  const env = encodeSignEnvelope({ schema: 5, walletUid: b(fx.wallet_uid_hex), reqPayload: b(fx.generic_signing_req_hex) });
  assert.equal(h(env), fx.sign_envelope_hex);
});

test("DER encoding matches elliptic toDER, including the sign-bit pad", () => {
  assert.equal(h(encodeDerSignature(b(fx.der_sample_r_hex), b(fx.der_sample_s_hex))), fx.der_sample_hex);
  // Leading zero bytes are dropped; a value of zero stays one byte.
  assert.equal(h(encodeDerSignature(Uint8Array.of(0, 0, 0x7f), Uint8Array.of(0, 0))), "300602017f020100");
});

test("DER parsing matches parseDER", () => {
  const { r, s } = parseDerSignature(b(fx.der_sample_hex));
  const pad = (x: Uint8Array) => h(x).padStart(64, "0").slice(-64);
  assert.equal(pad(r), fx.der_sample_r_hex);
  assert.equal(pad(s), fx.der_sample_s_hex);
});

test("response parser accepts a good frame and rejects a bad checksum", () => {
  const header = Uint8Array.from([0x01, 0x00, 0, 0, 0, 1, 0, 1, 0]);
  const crc = new Uint8Array(4);
  new DataView(crc.buffer).setUint32(0, crc32Lattice(header), false);
  const good = concatBytes(header, crc);
  assert.equal(parseLatticeResponse(good).responseCode, 0);
  const bad = good.slice();
  bad[bad.length - 1] ^= 0xff;
  assert.throws(() => parseLatticeResponse(bad), /checksum/);
});

test("prehash path: payload above 3,019 bytes sends its keccak digest", () => {
  const payload = new Uint8Array(3020).fill(7);
  const req = encodeGenericSigningRequest({ signerPath: fx.signer_path, payload, curve: 0, hashType: 1, encoding: 4 });
  assert.equal(req.prehashed, true);
  assert.equal(req.extraPayloads.length, 0);
  assert.throws(
    () => encodeGenericSigningRequest({ signerPath: fx.signer_path, payload, curve: 0, hashType: 0, encoding: 1 }),
    /hashType=NONE/,
  );
});

test("WebCrypto AES-CBC round-trips aligned frames without padding, for every final block", async () => {
  const key = b(fx.shared_secret_hex);
  for (const size of [16, 144, 160, 1728]) {
    for (let trial = 0; trial < 8; trial += 1) {
      const plain = crypto.getRandomValues(new Uint8Array(size));
      const cipher = await latticeAesEncrypt(plain, key);
      assert.equal(cipher.length, size);
      assert.deepEqual(await latticeAesDecrypt(cipher, key), plain);
    }
  }
  await assert.rejects(latticeAesDecrypt(new Uint8Array(15), key), /block-aligned/);
});
