/** Safe's released v0.3.0 module, bound to EntryPoint v0.7. */
export const SAFE_4337_MODULE = "0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226" as const;
export const SAFE_MODULE_SETUP = "0x2dd68b007B46fBe91B9A7c3EDa5A7a1063cB5b47" as const;
export const SAFE_OP_TYPES = {
  SafeOp: [
    { name: "safe", type: "address" }, { name: "nonce", type: "uint256" },
    { name: "initCode", type: "bytes" }, { name: "callData", type: "bytes" },
    { name: "verificationGasLimit", type: "uint128" }, { name: "callGasLimit", type: "uint128" },
    { name: "preVerificationGas", type: "uint256" }, { name: "maxPriorityFeePerGas", type: "uint128" },
    { name: "maxFeePerGas", type: "uint128" }, { name: "paymasterAndData", type: "bytes" },
    { name: "validAfter", type: "uint48" }, { name: "validUntil", type: "uint48" },
    { name: "entryPoint", type: "address" },
  ],
} as const;

export interface SafeUserOperation {
  sender: `0x${string}`; nonce: `0x${string}`; callData: `0x${string}`;
  verificationGasLimit: `0x${string}`; callGasLimit: `0x${string}`; preVerificationGas: `0x${string}`;
  maxPriorityFeePerGas: `0x${string}`; maxFeePerGas: `0x${string}`;
  paymaster?: `0x${string}`; paymasterVerificationGasLimit?: `0x${string}`; paymasterPostOpGasLimit?: `0x${string}`; paymasterData?: `0x${string}`;
}
/** Pure wire-format projection shared by the wallet signer and proxy verifier. */
export function getSafeOpTypedData(op: SafeUserOperation, chainId: number, validUntil: number) {
  const uint128 = (value: string) => { const n = BigInt(value); if (n < 0n || n >= 1n << 128n) throw new Error("Invalid uint128"); return n.toString(16).padStart(32, "0"); };
  return { domain: { chainId, verifyingContract: SAFE_4337_MODULE }, types: SAFE_OP_TYPES, primaryType: "SafeOp" as const,
    message: { safe: op.sender, nonce: BigInt(op.nonce), initCode: "0x" as `0x${string}`, callData: op.callData,
      verificationGasLimit: BigInt(op.verificationGasLimit), callGasLimit: BigInt(op.callGasLimit), preVerificationGas: BigInt(op.preVerificationGas),
      maxPriorityFeePerGas: BigInt(op.maxPriorityFeePerGas), maxFeePerGas: BigInt(op.maxFeePerGas),
      paymasterAndData: (op.paymaster ? `${op.paymaster}${uint128(op.paymasterVerificationGasLimit ?? "0x0")}${uint128(op.paymasterPostOpGasLimit ?? "0x0")}${(op.paymasterData ?? "0x").slice(2)}` : "0x") as `0x${string}`,
      validAfter: 0, validUntil, entryPoint: "0x0000000071727De22E5E9d8BAf0edAc6f37da032" as `0x${string}` } };
}
export const SAFE_4337_MODULE_CODE_HASH = "0x2aea997c4e3cf0e2f333025372e219abcfde81c21fc2f8fb066414a5685dd3e0" as const;
