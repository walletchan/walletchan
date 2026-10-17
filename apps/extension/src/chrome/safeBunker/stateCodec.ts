import { assertBunkerChainId } from "./chainIdentity";
import { isAddress } from "viem";
import { exactRecord, assertBunkerDraftId } from "./record";
import type { BunkerState } from "./types";

const statuses = new Set(["queued", "reviewed", "signed", "ambiguous", "pending", "confirmed", "reverted", "rejected", "invalidated"]);
export function boundedString(value: unknown, max = 256): asserts value is string {
  if (typeof value !== "string" || !value || value.length > max) throw new Error("Invalid Bunker text");
}
export function uint(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,77})$/.test(value) || BigInt(value) >= 2n ** 256n) throw new Error("Invalid Bunker quantity");
}
export function hex(value: unknown, bytes?: number): asserts value is `0x${string}` {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value) || value.length > 600000 ||
    (bytes !== undefined && value.length !== 2 + bytes * 2)) throw new Error("Invalid Bunker bytes");
}
function index(value: unknown): void {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 0x7fffffff) throw new Error("Invalid Bunker index");
}
function optionalKeys(value: unknown, required: string[], optional: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Bunker state");
  const keys = Object.keys(value);
  if (!required.every((k) => keys.includes(k)) || keys.some((k) => ![...required, ...optional].includes(k))) throw new Error("Unknown Bunker state fields");
  return value as Record<string, any>;
}
export function decodeBunkerState(value: unknown): BunkerState {
  const s = optionalKeys(value, ["version", "chainId", "chainName", "seedGroupId", "id", "accountId", "plan", "activated", "archived", "ownerIndex", "nextIndex", "exposureUnknown", "usedOwners", "defaultPayer", "operations", "recovery"], []);
  if (s.version !== 2 || typeof s.activated !== "boolean" || typeof s.archived !== "boolean" || typeof s.exposureUnknown !== "boolean") throw new Error("Unsupported Bunker state");
  assertBunkerChainId(s.chainId); boundedString(s.seedGroupId, 128); boundedString(s.chainName, 128);
  assertBunkerDraftId(s.id); boundedString(s.accountId); index(s.ownerIndex); index(s.nextIndex);
  const p = optionalKeys(s.plan, ["address", "initializer", "salt", "fromBlock"], ["deploymentHash", "raw", "verifiedBlock"]);
  hex(p.address, 20); hex(p.initializer); uint(p.salt); uint(p.fromBlock);
  if (p.raw !== undefined) hex(p.raw);
  if (p.verifiedBlock !== undefined) { const anchor = exactRecord(p.verifiedBlock, ["number", "hash"]); uint(anchor.number); hex(anchor.hash, 32); }
  if (!Array.isArray(s.usedOwners) || s.usedOwners.length > 4096) throw new Error("Bunker historical owner limit");
  s.usedOwners.forEach((a) => hex(a, 20));
  if (p.deploymentHash !== undefined) hex(p.deploymentHash, 32);
  if (s.defaultPayer !== null) { const d = exactRecord(s.defaultPayer, ["id", "address"]); boundedString(d.id); hex(d.address, 20); }
  if (!Array.isArray(s.operations) || s.operations.length > 100) throw new Error("Bunker operation limit");
  const ids = new Set();
  for (const candidate of s.operations) {
    const o = optionalKeys(candidate, ["id", "calls", "routes", "kind", "state", "createdAt"], ["review", "signature", "outer", "receipt", "error", "published", "resultPublished", "scanBlock", "members"]);
    boundedString(o.id); if (ids.has(o.id)) throw new Error("Duplicate Bunker operation"); ids.add(o.id);
    if (!["transaction", "recovery"].includes(o.kind) || !statuses.has(o.state) || !Number.isSafeInteger(o.createdAt) || o.createdAt < 0) throw new Error("Invalid Bunker operation");
    if (!Array.isArray(o.calls) || o.calls.length > 99 || (!o.calls.length && o.kind !== "recovery")) throw new Error("Invalid Bunker calls");
    let length = 0;
    for (const c of o.calls) { exactRecord(c, ["to", "value", "data", "operation"]); if (!isAddress(c.to) || c.operation !== 0) throw new Error("Invalid Bunker call"); uint(c.value); hex(c.data); length += c.data.length; }
    if (length > 250000) throw new Error("Bunker calldata limit");
    if (!Array.isArray(o.routes) || !o.routes.length || o.routes.length > 99) throw new Error("Invalid Bunker routes");
    for (const r of o.routes) {
      optionalKeys(r, ["kind", "origin", "requestId"], ["tabId", "frameId", "topic", "remoteId"]);
      if (!["wallet", "injected", "walletConnect", "batch"].includes(r.kind)) throw new Error("Invalid Bunker route");
      boundedString(r.origin, 2048); boundedString(r.requestId);
      if (r.topic !== undefined) boundedString(r.topic);
      for (const k of ["tabId", "frameId", "remoteId"]) if (r[k] !== undefined && (!Number.isSafeInteger(r[k]) || r[k] < 0)) throw new Error("Invalid Bunker route identity");
    }
    if (o.members !== undefined) {
      if (!Array.isArray(o.members) || o.members.length < 2 || o.members.length > 99) throw new Error("Invalid Bunker group");
      if (JSON.stringify(o.members.flatMap((m: any) => m.calls)) !== JSON.stringify(o.calls) || JSON.stringify(o.members.flatMap((m: any) => m.routes)) !== JSON.stringify(o.routes)) throw new Error("Bunker group membership mismatch");
      for (const member of o.members) { exactRecord(member, ["id", "calls", "routes", "createdAt"]); boundedString(member.id); }
    }
    if (o.scanBlock !== undefined) uint(o.scanBlock);
    if (o.error !== undefined) boundedString(o.error, 512);
    if (o.resultPublished !== undefined && typeof o.resultPublished !== "boolean") throw new Error("Invalid Bunker result publication");
    if (o.published !== undefined && typeof o.published !== "boolean") throw new Error("Invalid Bunker publication");
    if (o.review !== undefined) {
      const r = exactRecord(o.review, ["digest", "expiresAt", "payerId", "payerAddress", "ownerIndex", "nextIndex", "nonce", "configEpoch", "transaction", "safeTxHash", "gas", "maxFee"]);
      hex(r.digest, 32); hex(r.safeTxHash, 32); hex(r.payerAddress, 20); boundedString(r.payerId); boundedString(r.configEpoch);
      index(r.ownerIndex); index(r.nextIndex); index(r.nonce); index(Math.floor((r.expiresAt as number) / 1000000));
      if (!Number.isSafeInteger(r.expiresAt) || (r.expiresAt as number) < 0) throw new Error("Invalid review time");
      const tx = exactRecord(r.transaction, ["to", "value", "data", "operation", "safeTxGas", "baseGas", "gasPrice", "gasToken", "refundReceiver", "nonce"]);
      hex(tx.to, 20); hex(tx.data); uint(tx.value); index(tx.nonce);
      if (![0, 1].includes(tx.operation as number) || tx.safeTxGas !== "0" || tx.baseGas !== "0" || tx.gasPrice !== "0" || tx.gasToken !== `0x${"0".repeat(40)}` || tx.refundReceiver !== tx.gasToken) throw new Error("Bunker reimbursement is forbidden");
      const g = exactRecord(r.gas, ["gasLimit", "maxFeePerGas", "maxPriorityFeePerGas"]); Object.values(g).forEach(uint); uint(r.maxFee);
    }
    if (o.signature !== undefined) { hex(o.signature, 65); if (!o.review) throw new Error("Unbound Bunker signature"); }
    if (o.outer !== undefined) { const b = exactRecord(o.outer, ["raw", "hash", "payerId", "payerAddress"]); hex(b.raw); hex(b.hash, 32); boundedString(b.payerId); hex(b.payerAddress, 20); }
    if (o.receipt !== undefined) { const r = exactRecord(o.receipt, ["hash", "block", "blockHash", "timestamp"]); hex(r.hash, 32); hex(r.blockHash, 32); uint(r.block); if (!Number.isSafeInteger(r.timestamp) || (r.timestamp as number) < 0) throw new Error("Invalid Bunker receipt"); }
  }
  if (s.recovery !== null) {
    const r = optionalKeys(s.recovery, ["scanBlock", "targetBlock", "deriveIndex", "matchedIndex", "usedOwners"], ["targetOwner"]);
    if (r.targetOwner !== undefined) hex(r.targetOwner, 20);
    uint(r.scanBlock); uint(r.targetBlock); index(r.deriveIndex); if (r.matchedIndex !== null) index(r.matchedIndex);
    if (!Array.isArray(r.usedOwners) || r.usedOwners.length > 4096) throw new Error("Bunker recovery history limit");
    r.usedOwners.forEach((a) => hex(a, 20));
  }
  return structuredClone(s) as unknown as BunkerState;
}
