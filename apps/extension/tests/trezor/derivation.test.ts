import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTrezorDerivationPage,
  isReleasedTrezorPath,
  MAX_TREZOR_DERIVATION_INDEX,
  TREZOR_DEVICE_IDENTITY_PATH,
} from "../../src/chrome/trezor/derivation";

test("Trezor identity and released derivation templates are exact", () => {
  assert.equal(TREZOR_DEVICE_IDENTITY_PATH, "m/44'/60'/0'/0/0");
  assert.deepEqual(
    buildTrezorDerivationPage({
      scheme: "standard",
      startIndex: 3,
      count: 2,
    }),
    [
      { hdPath: "m/44'/60'/0'/0/3", hdIndex: 3 },
      { hdPath: "m/44'/60'/0'/0/4", hdIndex: 4 },
    ],
  );
  assert.deepEqual(
    buildTrezorDerivationPage({
      scheme: "account",
      startIndex: 3,
      count: 1,
    }),
    [{ hdPath: "m/44'/60'/3'/0/0", hdIndex: 3 }],
  );
  assert.deepEqual(
    buildTrezorDerivationPage({
      scheme: "legacy",
      startIndex: 3,
      count: 1,
    }),
    [{ hdPath: "m/44'/60'/0'/3", hdIndex: 3 }],
  );
});

test("Trezor discovery rejects oversized and overflowing pages", () => {
  assert.throws(() =>
    buildTrezorDerivationPage({
      scheme: "standard",
      startIndex: 0,
      count: 21,
    }),
  );
  assert.throws(() =>
    buildTrezorDerivationPage({
      scheme: "standard",
      startIndex: MAX_TREZOR_DERIVATION_INDEX,
      count: 2,
    }),
  );
  assert.throws(() =>
    buildTrezorDerivationPage({
      scheme: "standard",
      startIndex: -1,
      count: 1,
    }),
  );
});

test("only an exact released path and matching index pass", () => {
  assert.equal(
    isReleasedTrezorPath("m/44'/60'/0'/0/8", 8),
    true,
  );
  assert.equal(
    isReleasedTrezorPath("m/44'/60'/8'/0/0", 8),
    true,
  );
  assert.equal(
    isReleasedTrezorPath("m/44'/60'/0'/8", 8),
    true,
  );
  assert.equal(
    isReleasedTrezorPath("m/44'/60'/0'/0/9", 8),
    false,
  );
  assert.equal(
    isReleasedTrezorPath("m/44'/60'/0'/0/8/1", 8),
    false,
  );
});
