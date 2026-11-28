import assert from "node:assert/strict";
import test from "node:test";
import { canDeployBunker, deployedBunker, localBunkerDiscoveryRows, mergeDiscoveryRow, noBunkersFound, type DiscoveryRow } from "../../src/components/SafeBunker/discoveryModel";
const deployed: DiscoveryRow = { chainId: 1, address: "0x1234", status: "deployed" };
test("known deployment remains visible and unavailable during loading and failure", () => {
  const checking = mergeDiscoveryRow(deployed, { chainId: 1, status: "checking" });
  const failed = mergeDiscoveryRow(checking, { chainId: 1, status: "error" });
  assert.equal(deployedBunker(checking), true);
  assert.equal(deployedBunker(failed), true);
  assert.equal(canDeployBunker(checking), false);
  assert.equal(canDeployBunker(failed), false);
  assert.equal(deployedBunker(mergeDiscoveryRow(failed, { ...deployed, status: "absent" })), false);
});
test("unknown, failed and absent probes never masquerade as deployments", () => {
  for (const row of [undefined, { chainId: 1, status: "error" }, { chainId: 1, status: "checking" }, { ...deployed, status: "absent" }] as (DiscoveryRow | undefined)[])
    assert.equal(deployedBunker(row), false);
  for (const status of ["deployed", "local", "pending", "searching"] as const)
    assert.equal(deployedBunker({ ...deployed, status }), true);
});

test("seed cards group known local deployments without probing or counting ordinary EOAs", () => {
  const bunker = (seedGroupId: string, chainId: number, deploymentPending?: true) => ({
    id: `bunker:${chainId}`, type: "safeBunker" as const, address: "0x1111111111111111111111111111111111111111",
    seedGroupId, chainId, deploymentPending, derivationVersion: 2 as const, bunkerId: "binding", createdAt: 1,
  });
  const accounts = [bunker("seed-a", 1), bunker("seed-a", 8453, true), bunker("seed-b", 10),
    { id: "eoa", type: "seedPhrase" as const, address: "0x2222222222222222222222222222222222222222", seedGroupId: "seed-c", derivationIndex: 0, createdAt: 1 }];
  const before = structuredClone(accounts);
  const rows = localBunkerDiscoveryRows(accounts);
  assert.deepEqual(Object.keys(rows).sort(), ["seed-a", "seed-b"]);
  assert.deepEqual(Object.keys(rows["seed-a"]).map(Number), [1, 8453]);
  assert.equal(rows["seed-a"][1].status, "local");
  assert.equal(rows["seed-a"][8453].status, "pending");
  assert.equal(rows["seed-b"][10].status, "local");
  assert.deepEqual(accounts, before);
});

test("discovery errors or unfinished checks do not block selecting a deployment network", () => {
  assert.equal(canDeployBunker({ chainId: 1, status: "new" }), true);
  assert.equal(deployedBunker({ chainId: 1, status: "new" }), false);
  assert.equal(canDeployBunker({ ...deployed, status: "absent" }), true);
  for (const status of ["checking", "error"] as const)
    assert.equal(canDeployBunker({ chainId: 1, status }), true);
  for (const status of ["pending", "searching", "deployed", "local"] as const)
    assert.equal(canDeployBunker({ ...deployed, status }), false);
  assert.equal(canDeployBunker(undefined), true);
});

test("empty discovery requires a conclusive absence on every requested network", () => {
  const absent: DiscoveryRow = { chainId: 1, address: "0x1234", status: "absent" };
  assert.equal(noBunkersFound([], {}), false);
  assert.equal(noBunkersFound([1], {}), false);
  assert.equal(noBunkersFound([1], { 1: absent }), true);
  assert.equal(noBunkersFound([1, 10], { 1: absent }), false);
  for (const status of ["checking", "error", "pending", "searching", "deployed", "local"] as const) {
    assert.equal(noBunkersFound([1, 10], { 1: absent, 10: { ...absent, chainId: 10, status } }), false);
  }
  assert.equal(noBunkersFound([1, 10], { 1: absent, 10: { ...absent, chainId: 10 } }), true);
});
