import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCOUNT_TYPE_CAPABILITIES,
  getAccountTypeCapabilities,
  hasAccountTypeCapability,
  isHardwareAccountType,
} from "../../src/chrome/hardware/accountCapabilities";
import { SAFE_ACCOUNT_TYPE_POLICY } from "../../src/chrome/safe/accountTypePolicy";

test("Trezor capabilities are exhaustive and match the released support boundary", () => {
  assert.deepEqual(getAccountTypeCapabilities("trezor"), {
    signingTransport: "trezor",
    customEvmChains: true,
    personalSign: true,
    typedDataSign: true,
    rawEthSign: false,
    erc5792Batch: false,
    crossDappBatch: false,
    eip7702: false,
    erc7715: false,
    feeTokenExecution: false,
    sponsoredTransfer: false,
    forceInclusion: false,
    directSwap: false,
    safeOwner: true,
    safeNativeExecution: true,
    privacyPoolsSingleTransaction: true,
    privacyPoolsMultiExit: false,
    approvalCleanupMutation: false,
    transactionReplacement: true,
    customNonce: true,
    agentPasswordSigning: true,
  });
  assert.equal(isHardwareAccountType("trezor"), true);
  assert.equal(hasAccountTypeCapability("trezor", "erc5792Batch"), false);
  assert.equal(hasAccountTypeCapability("not-an-account", "personalSign"), false);
});

test("the Safe account policy cannot grant authority absent from the central matrix", () => {
  for (const [accountType, policy] of Object.entries(
    SAFE_ACCOUNT_TYPE_POLICY,
  )) {
    const capabilities =
      ACCOUNT_TYPE_CAPABILITIES[
        accountType as keyof typeof ACCOUNT_TYPE_CAPABILITIES
      ];
    assert.equal(
      policy.ownerSigningPath !== null,
      capabilities.safeOwner,
      `${accountType} Safe owner`,
    );
    assert.equal(
      policy.executionSigningPath !== null,
      capabilities.safeNativeExecution,
      `${accountType} Safe executor`,
    );
    assert.equal(
      policy.feeTokenExecution,
      capabilities.feeTokenExecution &&
        capabilities.safeNativeExecution,
      `${accountType} Safe fee-token executor`,
    );
  }
});
