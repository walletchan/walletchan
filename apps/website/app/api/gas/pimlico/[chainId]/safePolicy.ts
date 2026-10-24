import { createPublicClient, decodeFunctionData, http, keccak256, parseAbi, recoverTypedDataAddress, type Hex } from "viem";
import * as chains from "viem/chains";
import { getSafeOpTypedData, SAFE_4337_MODULE, SAFE_4337_MODULE_CODE_HASH, type SafeUserOperation } from "@walletchan/shared/safe4337";

export interface SafeProxyAuthority { owners: readonly string[]; threshold: bigint; module: boolean; fallback: string; moduleCode: Hex | undefined; safeCode: Hex | undefined; singleton: string }
const SINGLETON = "0x41675c099f32341bf84bfc5382af534df5c7461a";
const PROXY_CODE_HASH = "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c";
/** Trusted chain defaults only; callers cannot choose an RPC destination. */
async function readSafeProxyAuthority(sender: Hex, chainId: number): Promise<SafeProxyAuthority> {
  const chain = Object.values(chains).find(c => c.id === chainId);
  if (!chain) throw new Error("Unsupported chain");
  const client = createPublicClient({ chain, transport: http(chain.rpcUrls.default.http[0], { timeout: 8000, retryCount: 0 }) });
  const blockNumber = await client.getBlockNumber();
  const abi = parseAbi(["function getOwners() view returns(address[])", "function getThreshold() view returns(uint256)", "function isModuleEnabled(address module) view returns(bool)"]);
  const [owners, threshold, module, fallback, moduleCode, safeCode, singleton] = await Promise.all([
    client.readContract({ address: sender, abi, functionName: "getOwners", blockNumber }),
    client.readContract({ address: sender, abi, functionName: "getThreshold", blockNumber }),
    client.readContract({ address: sender, abi, functionName: "isModuleEnabled", args: [SAFE_4337_MODULE], blockNumber }),
    client.getStorageAt({ address: sender, slot: "0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5", blockNumber }),
    client.getCode({ address: SAFE_4337_MODULE, blockNumber }), client.getCode({ address: sender, blockNumber }),
    client.getStorageAt({ address: sender, slot: `0x${"00".repeat(32)}`, blockNumber }),
  ]);
  return { owners, threshold, module, fallback: `0x${fallback?.slice(-40)}`, moduleCode, safeCode, singleton: `0x${singleton?.slice(-40)}` };
}
export async function verifySafeUserOperation(op: SafeUserOperation & { signature: Hex; eip7702Auth?: unknown }, chainId: number,
  readAuthority: typeof readSafeProxyAuthority = readSafeProxyAuthority): Promise<boolean> {
  if (op.eip7702Auth || !/^0x0{12}[0-9a-fA-F]{12}[0-9a-fA-F]{130}$/.test(op.signature)) return false;
  const validUntil = Number(BigInt(`0x${op.signature.slice(14, 26)}`));
  if (validUntil <= Date.now() / 1000 || validUntil > Date.now() / 1000 + 300) return false;
  try {
    decodeFunctionData({ abi: parseAbi(["function executeUserOp(address to,uint256 value,bytes data,uint8 operation)"]), data: op.callData });
    const signer = await recoverTypedDataAddress({ ...getSafeOpTypedData(op, chainId, validUntil), signature: `0x${op.signature.slice(26)}` });
    const a = await readAuthority(op.sender, chainId);
    return a.threshold === 1n && a.owners.length === 1 && a.owners[0].toLowerCase() === signer.toLowerCase() && a.module &&
      a.fallback.toLowerCase() === SAFE_4337_MODULE.toLowerCase() && !!a.moduleCode && keccak256(a.moduleCode) === SAFE_4337_MODULE_CODE_HASH &&
      !!a.safeCode && keccak256(a.safeCode) === PROXY_CODE_HASH && a.singleton.toLowerCase() === SINGLETON;
  } catch { return false; }
}
