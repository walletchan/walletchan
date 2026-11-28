import assert from "node:assert/strict";
import test from "node:test";
import { TypedDataEncoder } from "ethers";
import { hashTypedData, recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { validateEIP712TypedData } from "../../src/chrome/eip712Validator";
import { hyperliquidApproveAgent as payload } from "./hyperliquidFixture";

test("Hyperliquid namespaced types pass V3/V4 with identical signing digests", async () => {
  const types = Object.fromEntries(Object.entries(payload.types).filter(([name]) => name !== "EIP712Domain"));
  const expected = TypedDataEncoder.hash(payload.domain, types, payload.message);
  const signer = privateKeyToAccount(`0x${"11".repeat(32)}`);
  for (const method of ["eth_signTypedData_v3", "eth_signTypedData_v4"]) {
    for (const input of [payload, JSON.stringify(payload)]) {
      const result = validateEIP712TypedData(method, input);
      assert.equal(result.valid, true, result.error);
      const sanitized = JSON.parse(result.sanitized!);
      assert.deepEqual(sanitized, payload);
      assert.equal(hashTypedData(sanitized), expected);
      const signature = await signer.signTypedData(sanitized);
      assert.equal(await recoverTypedDataAddress({ ...payload, signature }), signer.address);
    }
  }
});

test("namespaced types retain strict field names and graph checks", () => {
  for (const name of ["Bad::Type", ":Type", "Type:", "Bad-Type", "Type()", "Type\nName"]) {
    const result = validateEIP712TypedData("eth_signTypedData_v4", {
      ...payload, types: { [name]: [] }, primaryType: name,
    });
    assert.equal(result.valid, false);
    assert.match(result.error!, /invalid name/);
  }
  const name = payload.primaryType;
  for (const [field, expected] of [
    [{ name: "bad:field", type: "string" }, /invalid name/],
    [{ name: "child", type: "Missing:Type" }, /undefined type/],
    [{ name: "child", type: name }, /Circular reference/],
  ] as const) {
    const result = validateEIP712TypedData("eth_signTypedData_v4", {
      ...payload, types: { [name]: [field] },
    });
    assert.equal(result.valid, false);
    assert.match(result.error!, expected);
  }
});
