import assert from "node:assert/strict";
import test from "node:test";

import { validateEIP712TypedData } from "../../src/chrome/eip712Validator";

const base = {
  types: {
    EIP712Domain: [{ name: "chainId", type: "uint256" }],
    Message: [{ name: "contents", type: "string" }],
  },
  domain: { chainId: 1 },
  primaryType: "Message",
  message: { contents: "hello" },
};

test("EIP-712 sanitization preserves a normal schema", () => {
  const result = validateEIP712TypedData("eth_signTypedData_v4", base);
  assert.equal(result.valid, true);
  assert.ok(result.sanitized);
  assert.deepEqual(JSON.parse(result.sanitized!), base);
});

test("EIP-712 schemas cannot use prototype properties as implicit types", () => {
  const result = validateEIP712TypedData("eth_signTypedData_v4", {
    ...base,
    types: {
      EIP712Domain: base.types.EIP712Domain,
      Message: [{ name: "payload", type: "toString" }],
    },
    message: { payload: "hidden" },
  });
  assert.equal(result.valid, false);
  assert.match(result.error || "", /undefined type/i);
});

test("EIP-712 schema and field identifiers are bounded to safe identifiers", () => {
  for (const data of [
    {
      ...base,
      types: {
        ...base.types,
        "bad-name": [{ name: "contents", type: "string" }],
      },
    },
    {
      ...base,
      types: {
        ...base.types,
        Message: [{ name: "bad-name", type: "string" }],
      },
    },
  ]) {
    const result = validateEIP712TypedData("eth_signTypedData_v4", data);
    assert.equal(result.valid, false);
    assert.match(result.error || "", /invalid name/i);
  }
});

test("EIP-712 rejects a domain that omits a declared field (would hash undefined)", () => {
  const empty = validateEIP712TypedData("eth_signTypedData_v4", { ...base, domain: {} });
  assert.equal(empty.valid, false);
  assert.match(empty.error!, /missing declared field 'chainId'/);
  const inherited = validateEIP712TypedData("eth_signTypedData_v4", {
    ...base,
    types: { ...base.types, EIP712Domain: [{ name: "constructor", type: "string" }] },
    domain: {},
  });
  assert.equal(inherited.valid, false);
  const nulled = validateEIP712TypedData("eth_signTypedData_v4", { ...base, domain: { chainId: null } });
  assert.equal(nulled.valid, false);
  assert.match(nulled.error!, /missing declared field 'chainId'/);
});

test("EIP-712 rejects a domain value that cannot be hashed as its type", () => {
  const contract = [{ name: "verifyingContract", type: "address" }];
  const { EIP712Domain: _, ...undeclared } = base.types;
  for (const input of [
    { ...base, domain: { chainId: "abc" } },
    { ...base, types: { ...base.types, EIP712Domain: contract }, domain: { verifyingContract: "0x123" } },
    // No EIP712Domain: types are derived from the domain, as viem does when signing.
    { ...base, types: undeclared, domain: { verifyingContract: "0x123" } },
  ]) {
    const result = validateEIP712TypedData("eth_signTypedData_v4", input);
    assert.equal(result.valid, false, JSON.stringify(input.domain));
    assert.equal(result.error, "Invalid domain: a value does not match its type");
  }
  // Struct and array domain fields are not dry-run hashed: a large array there costs seconds before approval.
  const heavy = validateEIP712TypedData("eth_signTypedData_v4", {
    ...base,
    types: { ...undeclared, EIP712Domain: [{ name: "arr", type: "T[]" }], T: [{ name: "f", type: "uint256" }] },
    domain: { arr: [{ f: "abc" }] },
  });
  assert.equal(heavy.valid, true);
  // Common valid encodings must still pass, declared or derived.
  const full = [
    { name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" }, { name: "salt", type: "bytes32" },
  ];
  for (const chainId of [1, "1", "0x1"]) {
    const domain = {
      name: "App", version: "1", chainId,
      verifyingContract: "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC", salt: `0x${"ab".repeat(32)}`,
    };
    for (const types of [{ ...undeclared, EIP712Domain: full }, undeclared]) {
      const result = validateEIP712TypedData("eth_signTypedData_v4", { ...base, types, domain });
      assert.equal(result.valid, true, `${JSON.stringify(chainId)} ${result.error}`);
    }
  }
});
