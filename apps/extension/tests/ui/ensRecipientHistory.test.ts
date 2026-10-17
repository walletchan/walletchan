import assert from "node:assert/strict";
import test from "node:test";
import { ENS_RECENT_CHANGE_MS, formatEnsUpdateAge, parseEnsRecipientHistory, recentEnsAddressUpdate, recipientEnsHistoryName } from "../../src/components/Transfer/model/ensRecipientHistory";

test("history only checks typed Ethereum ENS names, never raw addresses or other naming systems", () => {
  assert.equal(recipientEnsHistoryName("TEST.eth."), "test.eth");
  for (const value of ["0x123", "name.gwei", "name.base.eth", "name.eth.attacker.com", "bad name.eth"]) {
    assert.equal(recipientEnsHistoryName(value), null);
  }
});

test("recent changes have a 30 day boundary and reject future dates", () => {
  const now = Date.now();
  assert.equal(ENS_RECENT_CHANGE_MS, 30 * 24 * 60 * 60 * 1000);
  assert.equal(recentEnsAddressUpdate({ addressUpdatedAt: now - ENS_RECENT_CHANGE_MS }, now), now - ENS_RECENT_CHANGE_MS);
  for (const addressUpdatedAt of [null, now - ENS_RECENT_CHANGE_MS - 1, now + 1]) {
    assert.equal(recentEnsAddressUpdate({ addressUpdatedAt }, now), null);
  }
  assert.equal(recentEnsAddressUpdate({ addressUpdatedAt: null, ownerUpdatedAt: now, resolverUpdatedAt: now } as any, now), null);

});

test("incomplete, invalid and failed responses stay unavailable", () => {
  const history = { addressUpdatedAt: null };
  assert.deepEqual(parseEnsRecipientHistory({ success: true, history }), history);
  for (const response of [null, {}, { success: false, history }, { success: true, history: {} },
    { success: true, history: { ...history, addressUpdatedAt: "123" } },
    { success: true, history: { ...history, addressUpdatedAt: Date.now() + 120000 } }]) {
    assert.throws(() => parseEnsRecipientHistory(response));
  }
});

test("event age is readable for minutes, hours and days", () => {
  const now = Date.now();
  assert.equal(formatEnsUpdateAge(now - 10000, now), "just now");
  assert.equal(formatEnsUpdateAge(now - 120000, now), "2 minutes ago");
  assert.equal(formatEnsUpdateAge(now - 3600000, now), "1 hour ago");
  assert.equal(formatEnsUpdateAge(now - 172800000, now), "2 days ago");
});
