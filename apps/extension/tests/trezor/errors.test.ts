import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeTrezorError,
  TrezorError,
  TrezorErrorCode,
} from "../../src/chrome/trezor/errors";

test("Trezor errors use stable user-facing categories", () => {
  assert.equal(
    normalizeTrezorError({
      payload: {
        code: "Failure_ActionCancelled",
        error: "upstream cancellation detail",
      },
    }).code,
    TrezorErrorCode.USER_REJECTED,
  );
  assert.equal(
    normalizeTrezorError({
      code: "Device_Disconnected",
      message: "serial-like-detail",
    }).code,
    TrezorErrorCode.DEVICE_DISCONNECTED,
  );
  assert.equal(
    normalizeTrezorError("device is busy").code,
    TrezorErrorCode.TRANSPORT_BUSY,
  );
});

test("known WalletChan Trezor errors remain unchanged", () => {
  const error = new TrezorError(
    TrezorErrorCode.TIMEOUT,
    "The Trezor request timed out.",
  );
  assert.equal(normalizeTrezorError(error), error);
});

test("technical Trezor errors are control-free and bounded", () => {
  const normalized = normalizeTrezorError(
    `unknown\u0000detail${"x".repeat(1_000)}`,
  );
  assert.equal(normalized.code, TrezorErrorCode.UNKNOWN);
  assert.ok(normalized.technicalMessage.length <= 512);
  assert.equal(
    normalized.technicalMessage.includes(String.fromCharCode(0)),
    false,
  );
});
