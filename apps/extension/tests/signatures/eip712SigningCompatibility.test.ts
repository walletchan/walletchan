import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { TypedDataEncoder } from "ethers";
import { hashDomain, hashTypedData } from "viem";
import { encodeType } from "../../src/lib/clearSigning/matchDescriptor";
import {
  INTERNAL_ACCOUNT_TYPED_DATA_ERROR,
  RAW_ERC7710_DELEGATION_SIGNATURE_ERROR,
  validateEIP712TypedData,
} from "../../src/chrome/eip712Validator";

type Fields = { name: string; type: string }[];
function payload(primaryType: string, types: Record<string, Fields>, message: object = {}) {
  return { domain: {}, types: { EIP712Domain: [], ...types }, primaryType, message };
}

function canonicalHash(data: ReturnType<typeof payload>) {
  const types = Object.fromEntries(Object.entries(data.types).filter(([name]) => name !== "EIP712Domain"));
  assert.equal(encodeType(data.primaryType, types), TypedDataEncoder.from(types).encodeType(data.primaryType));
  return TypedDataEncoder.hash(data.domain, types, data.message);
}

function rejects(data: ReturnType<typeof payload>, error: RegExp, protectedAddresses: string[] = []) {
  for (const method of ["eth_signTypedData_v3", "eth_signTypedData_v4"]) {
    for (const input of [data, JSON.stringify(data)]) {
      const result = validateEIP712TypedData(method, input, protectedAddresses);
      assert.equal(result.valid, false);
      assert.match(result.error!, error);
    }
  }
}

test("distinct child schemas with empty arrays cannot exploit omitted signing dependencies", () => {
  for (const primaryType of ["Envelope", "App:Envelope"]) {
    const hashes = [];
    for (const fieldType of ["uint256", "string"]) {
      const data = payload(primaryType, {
        [primaryType]: [{ name: "children", type: "Child[]" }],
        Child: [{ name: "value", type: fieldType }],
      }, { children: [] });
      const viemHash = hashTypedData(data as never);
      const ethersHash = canonicalHash(data);
      hashes.push({ viemHash, ethersHash });
      const result = validateEIP712TypedData("eth_signTypedData_v4", data);
      assert.equal(result.valid, true, result.error);
      assert.equal(viemHash, ethersHash);
    }
    assert.notEqual(hashes[0].ethersHash, hashes[1].ethersHash);
    assert.notEqual(hashes[0].viemHash, hashes[1].viemHash);
  }
});

test("nested namespaced structs and their arrays retain canonical digests", () => {
  for (const [root, child] of [["App:Root", "Child"], ["Root", "App:Child"], ["App:Root", "App:Child"]]) {
    for (const suffix of ["", "[]"]) {
      const value = { value: 7 };
      const data = payload(root, {
        [root]: [{ name: "child", type: `${child}${suffix}` }],
        [child]: [{ name: "value", type: "uint256" }],
      }, { child: suffix ? [value] : value });
      for (const method of ["eth_signTypedData_v3", "eth_signTypedData_v4"]) {
        for (const input of [data, JSON.stringify(data)]) {
          const result = validateEIP712TypedData(method, input);
          assert.equal(result.valid, true, result.error);
          assert.deepEqual(JSON.parse(result.sanitized!), data);
          assert.equal(hashTypedData(JSON.parse(result.sanitized!)), canonicalHash(data));
        }
      }
    }
  }
});

test("declared-prefix aliases cannot inject unrelated signing dependencies", () => {
  const base = payload("App:Root", { "App:Root": [{ name: "value", type: "uint256" }] }, { value: 1 });
  for (const fields of [[], [{ name: "unrelated", type: "uint256" }]]) {
    const data = { ...base, types: { ...base.types, App: fields } };
    assert.equal(hashTypedData(data as never), hashTypedData(base as never));
    assert.equal(hashTypedData(data as never), canonicalHash(base));
    assert.equal(validateEIP712TypedData("eth_signTypedData_v4", data).valid, true);
  }
});

test("namespaced domain dependencies use the full schema", () => {
  for (const suffix of ["", "[]"]) {
    const types = {
      EIP712Domain: [{ name: "context", type: `App:Context${suffix}` }],
      "App:Context": [{ name: "value", type: "uint256" }],
    };
    const context = { value: 3 };
    const domain = { context: suffix ? [context] : context };
    assert.equal(hashDomain({ domain, types } as never), TypedDataEncoder.hashStruct("EIP712Domain", types, domain));
  }
});

test("CommonJS and ESM encoders both retain nested namespaced dependencies", () => {
  const cjs = createRequire(import.meta.url)("viem") as typeof import("viem");
  const data = payload("App:Root", {
    "App:Root": [{ name: "child", type: "App:Child[]" }],
    "App:Child": [{ name: "value", type: "uint256" }],
  }, { child: [] });
  assert.equal(hashTypedData(data as never), canonicalHash(data));
  assert.equal(cjs.hashTypedData(data as never), canonicalHash(data));
});

test("inherited prefixes are never used as type dependencies", () => {
  for (const prefix of Object.getOwnPropertyNames(Object.prototype)) {
    for (const name of [`${prefix}:Root`, `${prefix}:More:Root`]) {
      const data = payload(name, { [name]: [{ name: "value", type: "uint256" }] }, { value: 1 });
      for (const types of [data.types, Object.assign(Object.create(null), data.types)]) {
        const result = validateEIP712TypedData("eth_signTypedData_v4", { ...data, types });
        assert.equal(result.valid, true, result.error);
        assert.equal(hashTypedData(JSON.parse(result.sanitized!)), canonicalHash(data));
      }
    }
  }
});

test("primary type must resolve to an own schema entry", () => {
  for (const name of ["Missing", "App:Missing", "constructor", "__proto__", "constructor:Missing"]) {
    rejects(payload(name, { Message: [] }), /Missing type definition for 'primaryType'/);
  }
});

test("generic flat namespaced types retain exact names and distinct matching digests", () => {
  const seen = new Set<string>();
  for (const name of ["AB", "A:B", "A:B:C", "A_B", "A_B:C", "A:B_C", "string:Root"]) {
    const data = payload(name, { [name]: [{ name: "value", type: "uint256" }] }, { value: 1 });
    for (const method of ["eth_signTypedData_v3", "eth_signTypedData_v4"]) {
      for (const input of [data, JSON.stringify(data)]) {
        const result = validateEIP712TypedData(method, input);
        assert.equal(result.valid, true, result.error);
        assert.deepEqual(JSON.parse(result.sanitized!), data);
      }
    }
    const hash = hashTypedData(data as never);
    assert.equal(hash, canonicalHash(data));
    assert.equal(seen.has(hash), false);
    seen.add(hash);
  }
});

test("flat namespaced primitive arrays still match the original signing digest", () => {
  const data = payload("App:Root", { "App:Root": [{ name: "values", type: "uint256[]" }] }, { values: [1, 2] });
  const result = validateEIP712TypedData("eth_signTypedData_v4", data);
  assert.equal(result.valid, true, result.error);
  assert.equal(hashTypedData(JSON.parse(result.sanitized!) as never), canonicalHash(data));
});

test("namespaced requests retain own-property, cycle, depth and account-domain protection", () => {
  for (const type of ["toString", "constructor", "__proto__", "App:Missing"]) {
    rejects(payload("App:Root", { "App:Root": [{ name: "child", type }] }), /undefined type/);
  }
  rejects(payload("App:A", {
    "App:A": [{ name: "child", type: "App:B" }],
    "App:B": [{ name: "child", type: "App:A" }],
  }), /Circular reference/);
  const types: Record<string, Fields> = {};
  for (let i = 0; i < 52; i++) {
    types[`App:T${i}`] = [{ name: "value", type: i === 51 ? "uint256" : `App:T${i + 1}` }];
  }
  rejects(payload("App:T0", types), /nesting depth/);
  const address = "0x1111111111111111111111111111111111111111";
  const data = { ...payload("App:Root", { "App:Root": [] }), domain: { verifyingContract: address } };
  for (const method of ["eth_signTypedData_v3", "eth_signTypedData_v4"]) {
    assert.equal(validateEIP712TypedData(method, data, [address]).error, INTERNAL_ACCOUNT_TYPED_DATA_ERROR);
  }
});

test("renaming delegation caveats cannot bypass raw-delegation rejection", () => {
  const address = "0x1111111111111111111111111111111111111111";
  const data = payload("Delegation", {
    Delegation: [
      { name: "delegate", type: "address" }, { name: "delegator", type: "address" },
      { name: "authority", type: "bytes32" }, { name: "caveats", type: "App:Caveat[]" },
    ],
    "App:Caveat": [{ name: "enforcer", type: "address" }, { name: "terms", type: "bytes" }],
  }, { delegate: address, delegator: address, authority: `0x${"00".repeat(32)}`, caveats: [] });
  for (const method of ["eth_signTypedData_v3", "eth_signTypedData_v4"]) {
    assert.equal(validateEIP712TypedData(method, data).error, RAW_ERC7710_DELEGATION_SIGNATURE_ERROR);
  }
});
