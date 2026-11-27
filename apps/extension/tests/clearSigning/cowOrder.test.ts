import assert from "node:assert/strict";
import test from "node:test";
import { hashTypedData } from "viem";
import { createCowOrderFixture } from "../../src/preview/cowOrderFixtures";
import { COW_ORDER_FORMAT, COW_SETTLEMENT, getCowOrderDescriptor, isCowOrderCandidate, type CowTypedData } from "../../src/lib/clearSigning/cowOrder";
import { applyFormat, formatRuntimeGuardsPass } from "../../src/lib/clearSigning/applyFormat";
import { matchEip712Format, verifyDescriptorContext } from "../../src/lib/clearSigning/matchDescriptor";
import { formatUnit, formatUnitFull } from "../../src/components/ClearSigning/formatters/valueFormatters";

const signer = "0x63a556c75443b176b5a4078e929e38beb37a1ff2";
const zero = `0x${"0".repeat(40)}`;
function resolve(data: CowTypedData = createCowOrderFixture(), chain = 8453, from: string | null = signer) {
  return getCowOrderDescriptor(chain, String(data.domain?.verifyingContract), data, from);
}
function render(data: CowTypedData = createCowOrderFixture()) {
  const descriptor = resolve(data);
  assert.ok(descriptor);
  const matched = matchEip712Format(descriptor, data);
  assert.ok(matched);
  const input = { data: data.message, chainId: 8453, envelope: { from: signer } };
  assert.equal(formatRuntimeGuardsPass(matched.format, input, descriptor), true);
  return applyFormat(matched.format, input, descriptor);
}

test("exact public Base order binds to protocol and maps units without changing its digest", () => {
  const data = createCowOrderFixture();
  const before = JSON.stringify(data);
  const digest = hashTypedData(data as Parameters<typeof hashTypedData>[0]);
  const descriptor = resolve(data)!;
  assert.ok(descriptor);
  assert.equal(verifyDescriptorContext(descriptor, "eip712", 8453, COW_SETTLEMENT, data.domain), true);
  assert.equal(matchEip712Format(descriptor, data)?.formatKey, COW_ORDER_FORMAT);
  const fields = render(data);
  assert.deepEqual(fields.map((field) => field.label), ["Sell amount", "Minimum received", "Receiver", "Valid to", "Kind", "Partially fillable"]);
  assert.deepEqual(fields[0].values[0], { kind: "tokenAmount", amountRaw: "1000000", tokenAddress: data.message.sellToken, native: false, chainId: 8453, thresholdRaw: undefined, thresholdMessage: undefined, allowUnlimited: false, tokenMetadata: undefined });
  assert.equal(fields[1].values[0].kind, "tokenAmount");
  assert.equal((fields[1].values[0] as any).native, true);
  assert.equal(formatUnit("1000000", 6), "1");
  assert.equal(formatUnitFull("405761030829127", 18), "0.000405761030829127");
  assert.deepEqual(fields[3].values[0], { kind: "date", timestamp: 1792524896 });
  assert.deepEqual(fields[5].values[0], { kind: "raw", text: "false" });
  assert.equal(JSON.stringify(data), before);
  assert.equal(hashTypedData(data as Parameters<typeof hashTypedData>[0]), digest);
});

test("CoW detection rejects spoofed domain, deployment, schema and request chain", () => {
  const mutations: Array<(data: CowTypedData) => void> = [
    (d) => { d.domain!.name = "CowSwap"; },
    (d) => { d.domain!.version = "v3"; },
    (d) => { d.domain!.chainId = 1; },
    (d) => { d.domain!.chainId = true; },
    (d) => { delete d.domain!.chainId; },
    (d) => { d.domain!.verifyingContract = signer; },
    (d) => { d.domain!.salt = `0x${"ab".repeat(32)}`; },
    (d) => { d.primaryType = "OtherOrder"; },
    (d) => { d.types.Order[5].type = "uint256"; },
    (d) => { d.types.Order.reverse(); },
    (d) => { d.types.Order.push({ name: "extra", type: "uint256" }); d.message.extra = "1"; },
    (d) => { d.types.EIP712Domain[2].type = "uint32"; },
    (d) => { d.types.EIP712Domain.pop(); },
    (d) => { d.types.Extra = []; },
    (d) => { delete d.message.feeAmount; },
    (d) => { d.message.extra = "1"; },
  ];
  for (const mutate of mutations) {
    const data: CowTypedData = createCowOrderFixture(); mutate(data);
    assert.equal(resolve(data), null, mutate.toString());
  }
  assert.equal(resolve(createCowOrderFixture(), 1), null);
  assert.equal(getCowOrderDescriptor(8453, signer, createCowOrderFixture(), signer), null);
  assert.equal(isCowOrderCandidate(createCowOrderFixture()), true);
});

test("decimal/hex chain IDs and omitted domain schema preserve the binding", () => {
  for (const chainId of [8453, "8453", "0x2105"]) {
    const data: CowTypedData = createCowOrderFixture(); data.domain!.chainId = chainId;
    assert.ok(resolve(data));
    delete data.types.EIP712Domain;
    assert.ok(resolve(data));
  }
});

test("invalid scalar values, amounts and native token positions never receive a friendly profile", () => {
  for (const [field, invalid] of Object.entries({
    sellAmount: ["0", "-1", "1.5", true, null, Number.MAX_SAFE_INTEGER + 1, (1n << 256n).toString()],
    buyAmount: ["0", "abc", "1e18", {}], feeAmount: ["-1", false, ""],
    validTo: [-1, 2 ** 32, 1.1, null, true], partiallyFillable: ["false", 0, null],
    appData: ["0x12"], kind: ["SELL", "unknown"], receiver: ["apoorv.eth", "0x123"],
    sellToken: [zero, `0x${"e".repeat(40)}`], buyToken: [zero],
    sellTokenBalance: ["unknown", {}], buyTokenBalance: ["external", "unknown"],
  })) {
    for (const value of invalid) {
      const data: CowTypedData = createCowOrderFixture(); data.message[field] = value;
      assert.equal(resolve(data), null, `${field}: ${String(value)}`);
    }
  }
  const data = createCowOrderFixture(); data.message.buyTokenBalance = "internal";
  assert.equal(resolve(data), null, "native buy cannot be internal");
  data.message.buyToken = data.message.sellToken;
  assert.equal(resolve(data), null, "same asset");
});

test("buy, partial, fee, balance and zero-receiver semantics remain visible", () => {
  const data = createCowOrderFixture(); data.message.kind = "buy";
  assert.deepEqual(render(data).slice(0, 2).map((f) => f.label), ["Maximum sold", "Buy amount"]);
  data.message.partiallyFillable = true; data.message.feeAmount = "1000";
  data.message.sellTokenBalance = "external";
  let fields = render(data);
  assert.deepEqual(fields.slice(0, 3).map((f) => f.label), ["Sell limit (full order)", "Buy limit (full order)", "Signed fee (full order)"]);
  assert.ok(fields.find((f) => f.label === "Fill policy"));
  assert.deepEqual(fields.at(-1)?.values[0], { kind: "raw", text: "Balancer Vault external" });
  data.message.buyToken = "0x4200000000000000000000000000000000000006";
  data.message.buyTokenBalance = "internal";
  assert.deepEqual(render(data).at(-1)?.values[0], { kind: "raw", text: "Balancer Vault internal" });
  data.message.receiver = zero;
  fields = render(data);
  assert.deepEqual(fields.find((f) => f.label === "Receiver")?.values[0], { kind: "address", address: signer });
  assert.equal(resolve(data, 8453, null), null);
  assert.equal(resolve(data, 8453, zero), null);
});

test("order maxima stay numeric and metadata failure never invents precision", () => {
  const data = createCowOrderFixture(); data.message.buyAmount = ((1n << 256n) - 1n).toString();
  const fields = render(data);
  assert.equal((fields[1].values[0] as any).allowUnlimited, false);
  assert.notEqual(formatUnit(data.message.buyAmount, 18, false), "unlimited");
  assert.equal((fields[0].values[0] as any).tokenMetadata, undefined);
  data.message.sellAmount = ((1n << 256n) - 1n).toString(); data.message.feeAmount = "1";
  assert.equal(resolve(data), null, "sell plus fee overflow");
});
