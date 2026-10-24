/** Presentation-only CoW order recognition. Never authorizes or rewrites signing data. */
import { hashDomain } from "viem";

import type { Erc7730Descriptor, Erc7730Field } from "./types";

// Reviewed Base deployment: cowprotocol/docs, reference/contracts/core/README.mdx.
// Add networks only after reviewing their settlement deployment and native asset.
export const COW_SETTLEMENT = "0x9008d19f58aabd9ed0d60971565aa8510560ab41";
const DEPLOYMENTS = new Set([8453]);
const ZERO = "0x0000000000000000000000000000000000000000";
const NATIVE_BUY = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const MAX_UINT256 = (1n << 256n) - 1n;

const COW_DOMAIN_FIELDS = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
] as const;
const COW_ORDER_FIELDS = [
  { name: "sellToken", type: "address" },
  { name: "buyToken", type: "address" },
  { name: "receiver", type: "address" },
  { name: "sellAmount", type: "uint256" },
  { name: "buyAmount", type: "uint256" },
  { name: "validTo", type: "uint32" },
  { name: "appData", type: "bytes32" },
  { name: "feeAmount", type: "uint256" },
  { name: "kind", type: "string" },
  { name: "partiallyFillable", type: "bool" },
  { name: "sellTokenBalance", type: "string" },
  { name: "buyTokenBalance", type: "string" },
] as const;
export const COW_ORDER_FORMAT = `Order(${COW_ORDER_FIELDS.map(({ name, type }) => `${type} ${name}`).join(",")})`;

export interface CowTypedData {
  domain?: Record<string, unknown>;
  primaryType: string;
  types: Record<string, Array<{ name: string; type: string }>>;
  message: Record<string, unknown>;
}

function address(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

function uint(value: unknown, max: bigint): bigint | null {
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) return null;
  if (typeof value !== "number" && typeof value !== "bigint" &&
      !(typeof value === "string" && /^(?:[0-9]+|0x[\da-f]+)$/i.test(value) && value.length <= 78)) return null;
  try {
    const result = BigInt(value as string | number | bigint);
    return result >= 0n && result <= max ? result : null;
  } catch { return null; }
}

function exactKeys(record: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(record).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(record, key));
}

function sameFields(actual: CowTypedData["types"][string] | undefined, expected: readonly { name: string; type: string }[]): boolean {
  return Array.isArray(actual) && actual.length === expected.length && actual.every((field, i) =>
    field.name === expected[i].name && field.type === expected[i].type);
}

/** CoW-looking payloads cannot bypass the local guard through a remote descriptor. */
export function isCowOrderCandidate(data: CowTypedData): boolean {
  return data.primaryType === "Order" && (
    data.domain?.name === "Gnosis Protocol" ||
    (typeof data.domain?.verifyingContract === "string" &&
      data.domain.verifyingContract.toLowerCase() === COW_SETTLEMENT)
  );
}

export function getCowOrderDescriptor(
  chainId: number,
  verifyingContract: string,
  data: CowTypedData,
  signer?: string | null,
): Erc7730Descriptor | null {
  const domain = data.domain;
  const message = data.message;
  if (!DEPLOYMENTS.has(chainId) || !address(verifyingContract) ||
      verifyingContract.toLowerCase() !== COW_SETTLEMENT ||
      !domain || !exactKeys(domain, COW_DOMAIN_FIELDS.map((field) => field.name)) ||
      domain.name !== "Gnosis Protocol" || domain.version !== "v2" ||
      uint(domain.chainId, BigInt(Number.MAX_SAFE_INTEGER)) !== BigInt(chainId) ||
      !address(domain.verifyingContract) || domain.verifyingContract.toLowerCase() !== COW_SETTLEMENT ||
      data.primaryType !== "Order" || !sameFields(data.types.Order, COW_ORDER_FIELDS) ||
      !Object.keys(data.types).every((key) => key === "Order" || key === "EIP712Domain") ||
      !exactKeys(message, COW_ORDER_FIELDS.map((field) => field.name))) return null;

  const expectedDomain = { name: "Gnosis Protocol", version: "v2", chainId, verifyingContract: COW_SETTLEMENT as `0x${string}` };
  // EIP712Domain may be omitted (signers infer it); when supplied it must hash
  // exactly as CoW's fixed onchain domain, not as a UI-inferred replacement.
  const domainFields = data.types.EIP712Domain ?? COW_DOMAIN_FIELDS;
  if (!sameFields(domainFields, COW_DOMAIN_FIELDS)) return null;
  try {
    const actual = hashDomain({
      domain: { name: domain.name, version: domain.version, chainId: BigInt(chainId), verifyingContract: domain.verifyingContract },
      // sameFields above proved the supplied/inferred schema is this exact schema.
      types: { EIP712Domain: COW_DOMAIN_FIELDS },
    });
    const expected = hashDomain({ domain: { ...expectedDomain, chainId: BigInt(chainId) }, types: { EIP712Domain: COW_DOMAIN_FIELDS } });
    if (actual !== expected) return null;
  } catch { return null; }

  const sell = uint(message.sellAmount, MAX_UINT256);
  const buy = uint(message.buyAmount, MAX_UINT256);
  const fee = uint(message.feeAmount, MAX_UINT256);
  if (sell === null || sell === 0n || buy === null || buy === 0n || fee === null || sell + fee > MAX_UINT256 ||
      uint(message.validTo, (1n << 32n) - 1n) === null ||
      typeof message.appData !== "string" || !/^0x[\da-f]{64}$/i.test(message.appData) ||
      typeof message.partiallyFillable !== "boolean" ||
      (message.kind !== "sell" && message.kind !== "buy") ||
      typeof message.sellTokenBalance !== "string" || !["erc20", "external", "internal"].includes(message.sellTokenBalance) ||
      typeof message.buyTokenBalance !== "string" || !["erc20", "internal"].includes(message.buyTokenBalance) ||
      !address(message.sellToken) || !address(message.buyToken) || !address(message.receiver) ||
      [ZERO, NATIVE_BUY].includes(message.sellToken.toLowerCase()) || message.buyToken.toLowerCase() === ZERO ||
      message.sellToken.toLowerCase() === message.buyToken.toLowerCase() ||
      (message.buyToken.toLowerCase() === NATIVE_BUY && message.buyTokenBalance !== "erc20") ||
      (message.receiver.toLowerCase() === ZERO && (!address(signer) || signer.toLowerCase() === ZERO))) return null;

  const partial = message.partiallyFillable;
  const tokenField = (path: string, token: string, label: string): Erc7730Field => ({
    path: `#.${path}`, label, format: "tokenAmount",
    params: { tokenPath: `#.${token}`, allowUnlimited: false },
  });
  const fields: Erc7730Field[] = [
    tokenField("sellAmount", "sellToken", partial ? "Sell limit (full order)" : message.kind === "sell" ? "Sell amount" : "Maximum sold"),
    tokenField("buyAmount", "buyToken", partial ? "Buy limit (full order)" : message.kind === "sell" ? "Minimum received" : "Buy amount"),
    { path: message.receiver.toLowerCase() === ZERO ? "@.from" : "#.receiver", label: "Receiver", format: "addressName" },
    { path: "#.validTo", label: "Valid to", format: "date" },
    { path: "#.kind", label: "Kind" },
    { path: "#.partiallyFillable", label: "Partially fillable" },
  ];
  if (fee > 0n) fields.splice(2, 0, tokenField("feeAmount", "sellToken", partial ? "Signed fee (full order)" : "Signed fee (additional)"));
  if (partial) fields.push({ label: "Fill policy", value: "Partial fills use this limit price; full amounts are not guaranteed." });
  if (message.sellTokenBalance !== "erc20") fields.push({ label: "Sell balance", value: `Balancer Vault ${message.sellTokenBalance}` });
  if (message.buyTokenBalance !== "erc20") fields.push({ label: "Buy balance", value: "Balancer Vault internal" });
  return {
    context: { eip712: { domain: expectedDomain, deployments: [{ chainId, address: COW_SETTLEMENT }] } },
    metadata: { owner: "CoW Protocol" },
    display: { formats: { [COW_ORDER_FORMAT]: { intent: "CoW Protocol order", fields, required: COW_ORDER_FIELDS.map((field) => `#.${field.name}`) } } },
  };
}
