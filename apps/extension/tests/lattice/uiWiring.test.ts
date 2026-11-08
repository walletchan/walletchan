/** Source-level checks that the Lattice UI uses the shared hardware flow and Lattice routes. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { getHardwareSetupProvider, getHardwareSetupUrl } from "../../src/app/hardwareSetupRoute";

const read = (path: string) => readFile(new URL(`../../src/${path}`, import.meta.url), "utf8");

test("Lattice setup route opens the full-tab add-lattice flow", () => {
  assert.equal(getHardwareSetupProvider("?route=add-lattice"), "lattice");
  assert.equal(
    getHardwareSetupUrl("lattice", (path) => `chrome-extension://id/${path}`),
    "chrome-extension://id/index.html?route=add-lattice",
  );
});

test("the Lattice adapter talks only to Lattice background routes", async () => {
  const adapter = await read("components/Lattice/latticeFlowAdapter.ts");
  for (const type of ["latticeConnect", "latticePair", "latticeScan", "addLatticeAccounts", "latticeCancel"]) {
    assert.match(adapter, new RegExp(`type: "${type}"`), type);
  }
  assert.match(adapter, /message\.type === "latticeStatus"/);
  // The renderer sends only chosen addresses; paths come from the setup session.
  assert.match(adapter, /addresses: selection\.addresses\.map\(\(\{ address \}\) => \(\{ address \}\)\)/);
  assert.doesNotMatch(adapter, /ledger|offscreen/i);
});

test("Lattice setup reuses the shared hardware flow with its own connection form", async () => {
  const flow = await read("components/Lattice/AddLatticeFlow.tsx");
  assert.match(flow, /<AddHardwareWalletFlow/);
  assert.match(flow, /renderLayout=\{layout\}/);
  assert.match(flow, /Pairing code/);
  assert.match(flow, /Connection endpoint/);
});

test("confirmation surfaces route Lattice accounts to Lattice signing", async () => {
  const actions = await read("components/TransactionConfirmation/useTransactionActions.ts");
  assert.match(actions, /accountType === "lattice"\s*\?\s*"confirmTransactionAsyncLattice"/);
  const status = await read("components/HardwareWallet/HardwareAccountSigningStatus.tsx");
  assert.match(status, /accountType === "lattice"/);
  const signature = await read("components/SignatureConfirmation/SignatureRequestConfirmation.tsx");
  assert.match(signature, /accountType === "lattice"/);
});
