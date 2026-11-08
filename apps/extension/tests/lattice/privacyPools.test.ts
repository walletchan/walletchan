/** Lattice joins Privacy Pools single transactions on the same terms as Ledger and Trezor. */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { isPrivacyPoolsMutationAccountType } from "../../src/chrome/privacy/deployment/accountPolicy";
import {
  PRIVACY_POOLS_MAINNET_RELEASE_POLICY,
  PRIVACY_POOLS_SEPOLIA_RELEASE_POLICY,
} from "../../src/chrome/privacy/deployment/manifest";
import { validatePrivacyRagequitBatchSelections } from "../../src/chrome/privacy/ragequit/prepare";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src");

test("Lattice may mutate Privacy Pools under the mainnet and Sepolia release policies", () => {
  for (const policy of [PRIVACY_POOLS_MAINNET_RELEASE_POLICY, PRIVACY_POOLS_SEPOLIA_RELEASE_POLICY]) {
    assert.equal(isPrivacyPoolsMutationAccountType("lattice", policy), true);
  }
});

test("a multi-deposit public exit batch is refused for Lattice, one deposit per transaction", () => {
  const batch = (accountType: string) =>
    ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"].map((commitmentId) => ({
      accountId: "account-1",
      accountType,
      accountAddress: "0x000000000000000000000000000000000000dEaD",
      commitmentId,
      sourceOperationId: null,
      expectedAmountWei: "1",
    }));
  const batchId = "00000000-0000-4000-8000-000000000000";
  // Control: the same batch from a software wallet passes this check.
  assert.doesNotThrow(() => validatePrivacyRagequitBatchSelections(batchId, batch("privateKey") as never));
  assert.throws(() => validatePrivacyRagequitBatchSelections(batchId, batch("lattice") as never), /invalid-request/);
});

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const target = path.join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(target) : [target];
  }));
  return nested.flat().filter((file) => /\.tsx?$/.test(file));
}

test("every Privacy Pools and Shield file that accepts Trezor also accepts Lattice", async () => {
  const files = [...(await sourceFiles(path.join(SRC, "chrome/privacy"))), ...(await sourceFiles(path.join(SRC, "components/Shield")))];
  const missing: string[] = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    if (source.includes('"trezor"') && !source.includes('"lattice"')) missing.push(path.relative(SRC, file));
  }
  assert.deepEqual(missing, []);
});
