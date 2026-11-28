import assert from "node:assert/strict";
import test from "node:test";
import { TypedDataEncoder } from "ethers";
import { hashTypedData } from "viem";
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
      if (primaryType.includes(":")) {
        // The actual installed encoder omits Child from the root type hash.
        assert.notEqual(viemHash, ethersHash);
        rejects(data, /namespaced struct reference/);
      } else {
        const result = validateEIP712TypedData("eth_signTypedData_v4", data);
        assert.equal(result.valid, true, result.error);
        assert.equal(viemHash, ethersHash);
      }
    }
    assert.notEqual(hashes[0].ethersHash, hashes[1].ethersHash);
    assert.equal(hashes[0].viemHash === hashes[1].viemHash, primaryType.includes(":"));
  }
});

test("references into and out of namespaced structs reject, including domain and arrays", () => {
  for (const [root, child] of [["App:Root", "Child"], ["Root", "App:Child"], ["App:Root", "App:Child"], ["EIP712Domain", "App:Child"]]) {
    for (const suffix of ["", "[]"]) {
      const data = payload(root, {
        [root]: [{ name: "child", type: `${child}${suffix}` }],
        [child]: [{ name: "value", type: "uint256" }],
      });
      rejects(data, /namespaced struct reference/);
    }
  }
});

test("declared-prefix aliases cannot inject unrelated signing dependencies", () => {
  const base = payload("App:Root", { "App:Root": [{ name: "value", type: "uint256" }] }, { value: 1 });
  for (const fields of [[], [{ name: "unrelated", type: "uint256" }]]) {
    const data = { ...base, types: { ...base.types, App: fields } };
    assert.notEqual(hashTypedData(data as never), hashTypedData(base as never));
    rejects(data, /ambiguous signing prefix/);
  }
});

test("declared types named like primitives cannot disguise a namespaced struct reference", () => {
  for (const type of ["uint256", "string", "address", "bytes32"]) {
    rejects(payload("App:Root", {
      "App:Root": [{ name: "children", type: `${type}[]` }],
      [type]: [{ name: "value", type: "bool" }],
    }, { children: [] }), /namespaced struct reference/);
  }
});

test("inherited-prefix lookups reject even with a null-prototype types object", () => {
  for (const prefix of Object.getOwnPropertyNames(Object.prototype)) {
    for (const name of [`${prefix}:Root`, `${prefix}:More:Root`]) {
      const data = payload(name, { [name]: [{ name: "value", type: "uint256" }] }, { value: 1 });
      rejects(data, /ambiguous signing prefix/);
      data.types = Object.assign(Object.create(null), data.types);
      rejects(data, /ambiguous signing prefix/);
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
