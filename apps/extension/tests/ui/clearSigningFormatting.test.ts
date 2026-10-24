import assert from "node:assert/strict";
import test from "node:test";
import {
  compareRawAmounts,
  formatDurationLabel,
  formatUnit,
  formatUnitFull,
  isUnlimitedAmount,
  formatTimestamp,
} from "../../src/components/ClearSigning/formatters/valueFormatters";

const maxUint256 = ((1n << 256n) - 1n).toString();
const maxUint160 = ((1n << 160n) - 1n).toString();

test("clear-signing formatters retain both ERC-20 and Permit2 unlimited sentinels", () => {
  assert.equal(isUnlimitedAmount(maxUint256), true);
  assert.equal(isUnlimitedAmount(maxUint160), true);
  assert.equal(formatUnit(maxUint256, 18), "unlimited");
  assert.equal(formatUnit(maxUint160, 6), "unlimited");
  assert.equal(isUnlimitedAmount("not-an-integer"), false);
});

test("compact and audit unit formats keep their distinct precision", () => {
  assert.equal(formatUnit("1234567890123456789", 18), "1.23456789");
  assert.equal(
    formatUnitFull("1234567890123456789", 18),
    "1.234567890123456789",
  );
  assert.equal(formatUnitFull("1234567890", 0), "1,234,567,890");
});

test("raw amount comparison and duration labels fail safely", () => {
  assert.equal(compareRawAmounts("10", "9"), 1);
  assert.equal(compareRawAmounts("9", "9"), 0);
  assert.equal(compareRawAmounts("8", "9"), -1);
  assert.equal(compareRawAmounts("bad", "9"), -1);
  assert.equal(formatDurationLabel(3661), "01:01:01");
  assert.equal(formatDurationLabel(-1), "-1");
});

test("clear-signing dates include seconds and an explicit local timezone", () => {
  const formatted = formatTimestamp(1792524896);
  assert.match(formatted, /2026/);
  assert.match(formatted, /GMT(?:[+-]\d{1,2}(?::\d{2})?)?/);
  assert.match(formatted, /:56/);
});

test("CoW numeric limits do not inherit unlimited approval formatting", () => {
  assert.notEqual(formatUnit(maxUint256, 18, false), "unlimited");
  assert.notEqual(formatUnit(maxUint160, 6, false), "unlimited");
  assert.equal(formatUnit("405761030829127", 18, false), "0.00040576");
});
