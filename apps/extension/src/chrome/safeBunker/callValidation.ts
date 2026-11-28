import { isAddress } from "viem";
import type { SafeCall } from "../safe/types";

export const BUNKER_CALLDATA_HEX_LIMIT = 250000;
export class BunkerCallValidationError extends Error {}

/** Shared unsigned-intake and authenticated-journal contract. No RPC or storage. */
export function assertBunkerCalls(value: unknown, allowEmpty = false): asserts value is SafeCall[] {
  if (!Array.isArray(value) || value.length > 99 || !allowEmpty && !value.length) throw new BunkerCallValidationError("Invalid Bunker calls");
  let length = 0;
  for (const call of value) {
    if (!call || typeof call !== "object" || Array.isArray(call) || Object.keys(call).length !== 4 ||
      !["to", "value", "data", "operation"].every(key => Object.prototype.hasOwnProperty.call(call, key)) ||
      typeof call.to !== "string" || !isAddress(call.to) || call.operation !== 0 ||
      typeof call.value !== "string" || !/^(0|[1-9][0-9]{0,77})$/.test(call.value) || BigInt(call.value) >= 2n ** 256n ||
      typeof call.data !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(call.data)) throw new BunkerCallValidationError("Invalid Bunker call");
    length += call.data.length;
  }
  if (length > BUNKER_CALLDATA_HEX_LIMIT) throw new BunkerCallValidationError("Bunker calldata limit");
}
