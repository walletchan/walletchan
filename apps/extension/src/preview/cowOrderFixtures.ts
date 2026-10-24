import type { PendingSignatureRequest } from "@/chrome/requests/pendingSignatureStorage";

/** Public example order, independent of the recognition policy. */
export function createCowOrderFixture(receiver = "0x63a556c75443b176b5a4078e929e38beb37a1ff2") {
  return {
    types: {
      EIP712Domain: [
        { name: "name", type: "string" }, { name: "version", type: "string" },
        { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" },
      ],
      Order: [
        { name: "sellToken", type: "address" }, { name: "buyToken", type: "address" },
        { name: "receiver", type: "address" }, { name: "sellAmount", type: "uint256" },
        { name: "buyAmount", type: "uint256" }, { name: "validTo", type: "uint32" },
        { name: "appData", type: "bytes32" }, { name: "feeAmount", type: "uint256" },
        { name: "kind", type: "string" }, { name: "partiallyFillable", type: "bool" },
        { name: "sellTokenBalance", type: "string" }, { name: "buyTokenBalance", type: "string" },
      ],
    },
    domain: { name: "Gnosis Protocol", version: "v2", chainId: 8453,
      verifyingContract: "0x9008d19f58aabd9ed0d60971565aa8510560ab41" },
    primaryType: "Order",
    message: {
      sellToken: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      buyToken: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", receiver,
      sellAmount: "1000000", buyAmount: "405761030829127", validTo: 1792524896,
      appData: "0x872c06fd52c6cf89e4cf691a0a290ba76e0f476d556730b67651319996948f24",
      feeAmount: "0", kind: "sell", partiallyFillable: false,
      sellTokenBalance: "erc20", buyTokenBalance: "erc20",
    },
  };
}

export function applyCowSignatureScenario(request: PendingSignatureRequest, scenario: string): PendingSignatureRequest {
  if (!scenario.startsWith("cow-")) return request;
  const typedData = createCowOrderFixture(request.accountAddress);
  if (scenario === "cow-buy") typedData.message.kind = "buy";
  if (scenario === "cow-partial") {
    typedData.message.partiallyFillable = true;
    typedData.message.feeAmount = "10000";
    typedData.message.sellTokenBalance = "external";
  }
  if (scenario === "cow-zero-receiver") typedData.message.receiver = `0x${"0".repeat(40)}`;
  if (scenario === "cow-spoof") typedData.domain.verifyingContract = `0x${"1".repeat(40)}`;
  return { ...request, origin: "https://swap.cow.fi", senderOrigin: "https://swap.cow.fi",
    signature: { method: "eth_signTypedData_v4", params: [request.accountAddress, JSON.stringify(typedData)], chainId: 8453 } };
}
