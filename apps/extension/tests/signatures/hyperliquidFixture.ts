// Shape from hyperliquid-dex/hyperliquid-python-sdk hyperliquid/utils/signing.py
// user_signed_payload / sign_agent. Public, synthetic values; never submitted.
export const hyperliquidApproveAgent = {
  types: {
    EIP712Domain: [
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
    ],
    "HyperliquidTransaction:ApproveAgent": [
      { name: "hyperliquidChain", type: "string" },
      { name: "agentAddress", type: "address" },
      { name: "agentName", type: "string" },
      { name: "nonce", type: "uint64" },
    ],
  },
  domain: {
    name: "HyperliquidSignTransaction",
    version: "1",
    chainId: 421614,
    verifyingContract: "0x0000000000000000000000000000000000000000",
  },
  primaryType: "HyperliquidTransaction:ApproveAgent",
  message: {
    hyperliquidChain: "Mainnet",
    agentAddress: "0x2222222222222222222222222222222222222222",
    agentName: "QA agent",
    nonce: 1700000000000,
  },
} as const;
