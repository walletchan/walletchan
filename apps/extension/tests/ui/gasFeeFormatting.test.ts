import assert from "node:assert/strict";
import test from "node:test";
import {
  formatEthCompact,
  formatCompactFee,
  formatEthExact,
  formatEthFee,
} from "../../src/lib/gasFormatUtils";
import {
  formatErc20FeeDisplayAmount,
  getErc20FeeStatusLabel,
} from "../../src/components/TransactionDetails/feeDisplay";

test("gas fee formatting preserves tiny non-zero wei values", () => {
  assert.equal(formatEthFee("1"), "0.000000000000000001 ETH");
  assert.equal(formatEthExact("1"), "0.000000000000000001 ETH");
});

test("gas fee display keeps meaningful precision while tooltip remains exact", () => {
  assert.equal(formatEthFee("11549450000000"), "0.0000115 ETH");
  assert.equal(formatEthExact("11549450000000"), "0.00001154945 ETH");
});

test("compact batch gas fees do not expose all 18 decimals inline", () => {
  assert.equal(formatEthCompact("941090603166"), "0.000000941 ETH");
});

test("ERC-20 fee formatting uses lazy token metadata", () => {
  assert.equal(formatErc20FeeDisplayAmount({
    token: "0xfee",
    amountWei: "5847",
    symbol: "USDC",
    decimals: 6,
    usd: "$0.01",
    pending: false,
  }), "0.005847 USDC");
  assert.equal(formatErc20FeeDisplayAmount({
    token: "0xfee",
    amountWei: "5847",
    usd: null,
    pending: false,
  }), "5847 base units");
});

test("ERC-20 fee fallback distinguishes pending and unavailable settlement", () => {
  const base = { token: "0xfee", usd: null, pending: true };
  assert.equal(getErc20FeeStatusLabel(base), "Final fee pending");
  assert.equal(
    getErc20FeeStatusLabel({ ...base, pending: false }),
    "Fee amount unavailable",
  );
});

test("confirmation fee labels compact long zero runs while preserving non-zero fees", () => {
  assert.equal(formatCompactFee("5794000", "ETH"), "0.0₁₁5794 ETH");
  assert.equal(formatCompactFee("1", "ETH"), "1 wei");
  assert.equal(formatCompactFee("99999", "ETH"), "99,999 wei");
  assert.equal(formatCompactFee("0", "ETH"), "0 ETH");
  assert.equal(formatCompactFee("123456789000000", "ETH"), "0.0001235 ETH");
});
