import { decodeFunctionData, erc20Abi, formatUnits, isAddress, parseEther } from "viem";
import type { TransferMeta } from "../history/types";
import type { SafeCall } from "../safe/types";
import { fetchTokenInfo } from "../swap/tokenInfo";

export function decodeBunkerTransferMetadata(value: unknown, calls: SafeCall[]): TransferMeta {
  if (!value || typeof value !== "object" || Array.isArray(value) || calls.length !== 1) throw new Error("Invalid Bunker transfer metadata");
  const record = value as Record<string, unknown>;
  const keys = ["recipient", "amount", "symbol", "tokenLogo"];
  const clean = (text: unknown, maximum: number) => typeof text === "string" && text.length > 0 && text.length <= maximum &&
    !Array.from(text).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
  if (Object.keys(record).length !== keys.length || keys.some(key => !(key in record)) ||
    typeof record.recipient !== "string" || !isAddress(record.recipient) || !clean(record.amount, 160) ||
    !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(record.amount as string) || !clean(record.symbol, 64) ||
    record.tokenLogo !== null && !clean(record.tokenLogo, 2048)) throw new Error("Invalid Bunker transfer metadata");
  const call = calls[0];
  if (call.data === "0x") {
    if (record.recipient.toLowerCase() !== call.to.toLowerCase() || parseEther(record.amount as string) !== BigInt(call.value)) throw new Error("Bunker transfer metadata changed");
  } else {
    const decoded = decodeFunctionData({ abi: erc20Abi, data: call.data });
    if (decoded.functionName !== "transfer" || call.data.length !== 138 || BigInt(call.value) !== 0n ||
      decoded.args[0].toLowerCase() !== record.recipient.toLowerCase()) throw new Error("Bunker transfer metadata changed");
  }
  return { recipient: record.recipient.toLowerCase(), amount: record.amount as string, symbol: record.symbol as string, tokenLogo: record.tokenLogo as string | null };
}

/** Only the internal Send coordinator derives this snapshot from the actual transfer. */
export async function buildBunkerTransferMetadata(chainId: number, calls: SafeCall[], tokenLogo?: string | null,
  readTokenInfo: typeof fetchTokenInfo = fetchTokenInfo): Promise<TransferMeta | undefined> {
  if (calls.length !== 1) return undefined;
  const call = calls[0];
  let recipient: string = call.to;
  let amount = BigInt(call.value), token = "0x0000000000000000000000000000000000000000";
  if (call.data !== "0x") {
    if (call.data.length !== 138 || amount !== 0n) return undefined;
    try {
      const decoded = decodeFunctionData({ abi: erc20Abi, data: call.data });
      if (decoded.functionName !== "transfer") return undefined;
      [recipient, amount] = decoded.args;
      token = call.to;
    } catch { return undefined; }
  }
  const info = await readTokenInfo(token, chainId).catch(() => null);
  if (!info || amount <= 0n) return undefined;
  try {
    return decodeBunkerTransferMetadata({ recipient, amount: formatUnits(amount, info.decimals), symbol: info.symbol,
      tokenLogo: typeof tokenLogo === "string" && tokenLogo.length > 0 && tokenLogo.length <= 2048 ? tokenLogo : null }, calls);
  } catch { return undefined; }
}

export function assertBunkerNativeMax(value: unknown, calls: SafeCall[]) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 1 ||
    !("limit" in value) || typeof value.limit !== "string" || !/^[1-9][0-9]{0,77}$/.test(value.limit) ||
    BigInt(value.limit) >= 2n ** 256n || calls.length !== 1 || calls[0].operation !== 0 ||
    BigInt(calls[0].value) > BigInt(value.limit)) throw new Error("Invalid Bunker native MAX intent");
}

/** Reserve only what the Safe must fund after its EntryPoint deposit, plus headroom. */
export function bunkerNativeMaxAmount(balance: bigint, limit: bigint, deposit: bigint, maxFee: bigint, previousReserve = 0n) {
  const missing = maxFee > deposit ? maxFee - deposit : 0n;
  const reserve = (missing * 110n + 99n) / 100n;
  const retained = reserve > previousReserve ? reserve : previousReserve;
  const available = balance > retained ? balance - retained : 0n;
  return { amount: available < limit ? available : limit, reserve: retained };
}
