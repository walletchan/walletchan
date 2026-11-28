import assert from "node:assert/strict";
import test from "node:test";
import { formatEip712ValidationError } from "../../src/chrome/signatures/eip712/diagnostics";

test("typed-data errors include the reason and schema without message values", () => {
  const payload = {
    primaryType: "HyperliquidTransaction:ApproveAgent",
    domain: { name: "HyperliquidSignTransaction", chainId: "0x66eee" },
    types: { "HyperliquidTransaction:ApproveAgent": [{ name: "agentName", type: "string" }] },
    message: { agentName: "private-message-value" },
    extra: "private-extra-value",
  };
  for (const input of [payload, JSON.stringify(payload)]) {
    const error = formatEip712ValidationError("specific reason", "eth_signTypedData_v4", input, "https://app.example");
    for (const detail of ["specific reason", "HyperliquidTransaction:ApproveAgent", "HyperliquidSignTransaction", "0x66eee", "agentName", "eth_signTypedData_v4", "https://app.example"]) {
      assert.ok(error.includes(detail));
    }
    assert.doesNotMatch(error, /private-message-value|private-extra-value/);
  }
});

test("diagnostics handle malformed, oversized and hostile inputs with bounded output", () => {
  for (const payload of [undefined, null, "{invalid", "x".repeat(131073), {
    primaryType: "x".repeat(10000),
    types: Object.fromEntries(Array.from({ length: 64 }, (_, i) => [`Type${i}`, Array(32).fill({ name: "x".repeat(10000), type: "y".repeat(10000) })])),
  }]) {
    const error = formatEip712ValidationError("bad\nreason".repeat(1000), "eth_signTypedData_v4", payload);
    assert.ok(error.length <= 4096);
    assert.doesNotMatch(error, /\n/);
    assert.match(error, /Request:/);
  }
});
