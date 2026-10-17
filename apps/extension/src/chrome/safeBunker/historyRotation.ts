import { decodeFunctionData, parseAbi } from "viem";
import { decodeMultiSendTransactions } from "../safe/multiSend";
import type { BunkerReview } from "./types";

const multiSendAbi = parseAbi(["function multiSend(bytes transactions) payable"]);
const rotationAbi = parseAbi(["function swapOwner(address prevOwner,address oldOwner,address newOwner)"]);

/** Extract only public rotation facts from the exact reviewed transaction, never current state. */
export function getBunkerHistoryRotation(safe: string, review?: BunkerReview) {
  if (!review || ![review.ownerIndex, review.nextIndex].every((n) => Number.isSafeInteger(n) && n >= 0 && n <= 0x7fffffff)) return undefined;
  try {
    let call = review.transaction;
    if (call.operation === 1) {
      const { args } = decodeFunctionData({ abi: multiSendAbi, data: call.data });
      const calls = decodeMultiSendTransactions(args[0]);
      call = { ...call, ...calls[calls.length - 1] };
    }
    if (call.operation !== 0 || call.to.toLowerCase() !== safe.toLowerCase() || BigInt(call.value) !== 0n) return undefined;
    const { args } = decodeFunctionData({ abi: rotationAbi, data: call.data });
    return { oldOwner: args[1], newOwner: args[2], oldIndex: review.ownerIndex, newIndex: review.nextIndex };
  } catch { return undefined; }
}
