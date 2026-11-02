/**
 * Byte parity with ape-grid-lattice fixtures, which its generate.js builds with
 * the same npm libraries gridplus-sdk uses (crc-32, aes-js, elliptic, rlp).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { bytesToHex, hexToBytes, sha256 } from "viem";

import {
  LatticeEncryptedRequestType,
  buildConnectRequest,
  buildEncryptedRequest,
  buildSignerPathBuf,
  concatBytes,
  crc32Lattice,
  encodeGenericSigningRequest,
  encodeGetAddressesRequest,
  encodeSignEnvelope,
  latticeAesDecrypt,
  latticeAesEncrypt,
  latticeAppPublicKey,
  latticeEphemeralId,
  latticeSharedSecret,
  latticeSignerPath,
  pairingDigest,
  pairingNameBuffer,
  parseDerSignature,
  parseLatticeResponse,
} from "./protocolImports";

const fx = JSON.parse(readFileSync(new URL("./fixtures/apeGridParity.json", import.meta.url), "utf8"));
const b = (hex: string) => hexToBytes(`0x${hex}`);
const h = (bytes: Uint8Array) => bytesToHex(bytes).slice(2);

test("CRC-32 matches crc-32", () => {
  assert.equal(crc32Lattice(b(fx.crc_sample_hex)), fx.crc_sample_value);
});

test("P-256 public key matches elliptic", () => {
  assert.equal(h(latticeAppPublicKey(b(fx.app_priv_hex))), fx.app_pub_uncompressed_hex);
});

test("ECDH shared secret matches elliptic derive", () => {
  const secret = latticeSharedSecret(b(fx.app_priv_hex), b(fx.dev_pub_uncompressed_hex));
  assert.equal(h(secret), fx.shared_secret_hex);
  // Symmetric from the device side too.
  assert.equal(h(latticeSharedSecret(b(fx.dev_priv_hex), b(fx.app_pub_uncompressed_hex))), fx.shared_secret_hex);
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
  assert.equal(h(pairingDigest(b(fx.app_pub_uncompressed_hex), nameBuf, fx.pair_secret)), fx.pair_digest_hex);
  const manual = sha256(concatBytes(b(fx.app_pub_uncompressed_hex), nameBuf, new TextEncoder().encode(fx.pair_secret)), "bytes");
  assert.equal(h(manual), fx.pair_digest_hex);
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
