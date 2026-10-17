import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const extensionRoot = new URL("../../", import.meta.url);

async function source(path: string): Promise<string> {
  return readFile(new URL(path, extensionRoot), "utf8");
}

test("Ledger transport is Chrome-only and isolated in the shared hardware offscreen document", async () => {
  const [
    chromeManifest,
    firefoxManifest,
    bridge,
    manager,
    offscreen,
    handler,
    authorization,
  ] = await Promise.all([
      source("public/manifest.json"),
      source("manifest.firefox.json"),
      source("src/chrome/ledger/offscreenBridge.ts"),
      source("src/chrome/hardware/offscreenManager.ts"),
      source("src/offscreen/offscreen.ts"),
      source("src/offscreen/ledgerMessageHandler.ts"),
      source("src/offscreen/messageAuthorization.ts"),
    ]);
  assert.match(chromeManifest, /"offscreen"/);
  assert.doesNotMatch(firefoxManifest, /"offscreen"/);
  assert.match(bridge, /withHardwareOffscreenRequest/);
  assert.match(manager, /chrome\.offscreen\.createDocument/);
  assert.match(manager, /contextTypes: \[chrome\.runtime\.ContextType\.OFFSCREEN_DOCUMENT\]/);
  assert.match(offscreen, /walletchan-ledger-offscreen/);
  assert.match(offscreen, /isTrustedHardwareBackgroundSender\(sender\)/);
  assert.match(handler, /activeOperationId === opId/);
  assert.match(authorization, /senderUrl\.pathname === "\/static\/js\/background\.js"/);
  assert.match(authorization, /sender\.id !== extensionId \|\| sender\.tab/);
});

test("Ledger approval allows ten minutes without relaxing device discovery", async () => {
  const signer = await source("src/offscreen/ledgerSigner.ts");
  assert.match(signer, /const DISCOVERY_TIMEOUT_MS = 8_000/);
  assert.match(signer, /const ACTION_TIMEOUT_MS = 10 \* 60_000/);
});

test("Ledger setup launches through the shared hardware route", async () => {
  const [addAccount, app, route, sharedRoute, screen] = await Promise.all([
    source("src/components/AddAccount.tsx"),
    source("src/App.tsx"),
    source("src/app/ledgerSetupRoute.ts"),
    source("src/app/hardwareSetupRoute.ts"),
    source("src/components/Ledger/LedgerSetupScreen.tsx"),
  ]);
  assert.match(
    addAccount,
    /type === "ledger" \|\| type === "trezor"[\s\S]+openHardwareSetupTab\(type\)/,
  );
  assert.doesNotMatch(addAccount, /<AddLedgerFlow/);
  assert.match(route, /openHardwareSetupTab\("ledger"\)/);
  assert.match(sharedRoute, /chrome\.tabs\.create/);
  assert.match(sharedRoute, /closeSidePanelForWindow/);
  assert.match(sharedRoute, /sourceView !== "sidepanel"/);
  assert.match(sharedRoute, /route === "add-ledger"/);
  assert.match(sharedRoute, /`add-\$\{provider\}`/);
  assert.match(app, /getHardwareSetupProvider\(window\.location\.search\)/);
  assert.match(
    app,
    /view === "addAccount" && hardwareSetupProviderRef\.current/,
  );
  assert.match(
    app,
    /hardwareSetupProviderRef\.current === "trezor"[\s\S]+TrezorSetupScreen[\s\S]+LedgerSetupScreen/,
  );
  assert.match(app, /<HardwareSetupScreen/);
  assert.match(screen, /<AddLedgerFlow/);
});

test("Ledger identity uses local official SVG assets instead of an invented glyph", async () => {
  const [
    wordmark,
    lettermark,
    logo,
    brand,
    sharedLogo,
    avatar,
    panel,
    accountTypes,
  ] = await Promise.all([
    source("public/ledger-wordmark.svg"),
    source("public/ledger-lettermark.svg"),
    source("src/components/Ledger/LedgerLogo.tsx"),
    source("src/components/Ledger/ledgerBrand.ts"),
    source("src/components/HardwareWallet/HardwareWalletLogo.tsx"),
    source("src/components/Ledger/LedgerAvatar.tsx"),
    source("src/components/Ledger/LedgerDevicePanel.tsx"),
    source("src/components/AddAccountTypeGrid.tsx"),
  ]);
  assert.match(wordmark, /viewBox="0 0 2000\.58 669\.35"/);
  assert.match(lettermark, /viewBox="0 0 768\.91 669\.35"/);
  assert.match(brand, /ledger-wordmark\.svg/);
  assert.match(brand, /ledger-lettermark\.svg/);
  assert.match(logo, /HardwareWalletLogo/);
  assert.match(logo, /LEDGER_HARDWARE_WALLET_BRAND/);
  assert.match(sharedLogo, /maskImage/);
  assert.match(sharedLogo, /brand\.logoAssets\[variant\]/);
  assert.doesNotMatch(avatar, /<svg/);
  assert.match(panel, /<HardwareWalletDevicePanel/);
  assert.match(accountTypes, /<LedgerLogo variant="lettermark"/);
  assert.doesNotMatch(accountTypes, /HardwareWalletIcon/);

  const viewOnlyIndex = accountTypes.indexOf('type: "impersonator"');
  const ledgerIndex = accountTypes.indexOf('type: "ledger"');
  assert.ok(viewOnlyIndex >= 0);
  assert.ok(ledgerIndex > viewOnlyIndex);
});

test("Ledger storage contains public metadata and participates in reset", async () => {
  const [types, handlers, storage, reset] = await Promise.all([
    source("src/chrome/types.ts"),
    source("src/chrome/ledger/accountHandlers.ts"),
    source("src/chrome/ledger/storage.ts"),
    source("src/chrome/storage/resetManifest.ts"),
  ]);
  assert.match(types, /interface LedgerAccount/);
  assert.match(types, /deviceId: string/);
  assert.match(types, /hdPath: string/);
  const ledgerAccount = types.match(/interface LedgerAccount[^}]+}/)?.[0] ?? "";
  assert.doesNotMatch(ledgerAccount, /privateKey/);
  assert.match(handlers, /passwordType !== "master"/);
  assert.match(handlers, /WALLET_SECRET_OPERATION_LOCK_KEY/);
  assert.match(storage, /LEDGER_DEVICES_STORAGE_KEY = "ledgerDevices"/);
  assert.match(storage, /assertAccountStorageAuthorized\(expectedAuthEpoch\)/);
  assert.match(storage, /setActiveAccountId[\s\S]+\.catch\(/);
  assert.match(reset, /"ledgerDevices"/);
});

test("Ledger transaction and signature effects retain final account and authorization checks", async () => {
  const [transaction, signature] = await Promise.all([
    source("src/chrome/ledger/transactionExecution.ts"),
    source("src/chrome/ledger/signatureConfirmation.ts"),
  ]);
  assert.match(transaction, /beforeBroadcast/);
  assert.match(transaction, /getAccountById\(account\.id\)/);
  assert.match(transaction, /enforcePendingRequestAuthorizationAtConfirmation/);
  assert.match(transaction, /guardPendingRequestEffectLease/);
  assert.match(transaction, /authorizePrivacyConfirmation\(pending\)/);
  assert.match(transaction, /beginPrivacyShieldSubmission/);
  assert.match(transaction, /beginPrivacyRagequitSubmission/);
  assert.match(transaction, /beginPrivacyDirectUnshieldSubmission/);
  assert.match(signature, /prepareSignatureConfirmation/);
  assert.match(signature, /revalidatePendingSignatureBeforeRelease/);
  assert.match(signature, /guardPendingRequestEffectLease/);
});

test("Ledger requests remain reviewable and immutable until hardware approval", async () => {
  const [
    transaction,
    signature,
    txUi,
    txActions,
    signatureUi,
    signatureScreen,
    status,
    sharedStatus,
  ] = await Promise.all([
      source("src/chrome/ledger/transactionExecution.ts"),
      source("src/chrome/ledger/signatureConfirmation.ts"),
      source(
        "src/components/TransactionConfirmation/TransactionConfirmation.tsx",
      ),
      source("src/components/TransactionConfirmation/ConfirmationActions.tsx"),
      source(
        "src/components/SignatureConfirmation/SignatureRequestConfirmation.tsx",
      ),
      source(
        "src/components/SignatureConfirmation/SignatureConfirmationScreen.tsx",
      ),
      source("src/components/Ledger/LedgerSigningStatus.tsx"),
      source(
        "src/components/HardwareWallet/HardwareWalletSigningStatus.tsx",
      ),
    ]);

  const txSigning = transaction.indexOf("const signerInput =");
  const txRemoval = transaction.indexOf("await removePendingTxRequest(txId)");
  const signatureSigning = signature.indexOf(
    "signature = await signLedgerSignatureRequest",
  );
  const signatureRemoval = signature.indexOf(
    "await removePendingSignatureRequest(sigId)",
  );

  assert.ok(txSigning >= 0);
  assert.ok(txRemoval > txSigning);
  assert.ok(signatureSigning >= 0);
  assert.ok(signatureRemoval > signatureSigning);
  assert.match(txUi, /isReadOnly=\{isLedgerWaiting \|\| !!replacement\}/);
  assert.match(txUi, /waitingForLedger=\{isLedgerWaiting\}/);
  assert.doesNotMatch(txUi, /isBackDisabled=\{isLedgerWaiting\}/);
  assert.match(
    txActions,
    /color="accentFg\.highlight"/,
  );
  assert.match(
    txUi,
    /requestState=\{isLedgerWaiting \? "ready" : actions\.state\}/,
  );
  assert.match(
    txUi,
    /actions\.state === "error" &&[\s\S]+accountType !== "ledger" &&[\s\S]+accountType !== "trezor"/,
  );
  assert.match(signatureUi, /loadingText=\{isLedgerWaiting \? "Waiting"/);
  assert.match(
    signatureUi,
    /color="accentFg\.highlight"/,
  );
  assert.match(signatureUi, /isInteractionLocked=\{isLedgerWaiting\}/);
  assert.doesNotMatch(
    signatureScreen,
    /isBackDisabled=\{isInteractionLocked\}/,
  );
  assert.match(status, /Sign the request in your Ledger/);
  assert.match(status, /HardwareWalletSigningStatus/);
  assert.match(status, /LEDGER_HARDWARE_WALLET_BRAND/);
  assert.match(sharedStatus, /HardwareWalletLogo/);
  assert.match(sharedStatus, /bg="black"/);
  assert.match(sharedStatus, /color="accentFg\.highlight"/);
});

test("unsupported Ledger execution modes fail closed", async () => {
  const [batch, swap, swapModel, transaction] = await Promise.all([
    source("src/components/BatchConfirmation/BatchTransactionConfirmation.tsx"),
    source("src/components/Swap/usePreparedSwap.ts"),
    source("src/components/Swap/swapSubmissionModel.ts"),
    source("src/chrome/ledger/transactionExecution.ts"),
  ]);
  assert.match(batch, /accountType === "ledger" \|\| accountType === "trezor"/);
  assert.match(swap, /getSwapSubmissionKind\(/);
  assert.match(swapModel, /hasAccountTypeCapability\(accountType, "directSwap"\)/);
  assert.match(transaction, /isForceInclusionSupportedForAccount/);
  assert.match(transaction, /processLedgerForceInclusion/);
  assert.match(transaction, /EIP-7702 delegation is not supported for Ledger accounts/);
});

test("Safe approvals and native execution reuse centralized Ledger signing", async () => {
  const [ledgerSigning, accountTypePolicy, ownerAuthorization, safeExecution, safeUi] =
    await Promise.all([
      source("src/chrome/ledger/signing.ts"),
      source("src/chrome/safe/accountTypePolicy.ts"),
      source("src/chrome/safe/ownerAuthorization.ts"),
      source("src/chrome/safe/execution.ts"),
      source(
        "src/components/SafeApprovals/SafeProposalConfirmation.tsx",
      ),
    ]);

  assert.match(ledgerSigning, /signLedgerTypedDataForAccount/);
  assert.match(ledgerSigning, /recoverTypedDataAddress/);
  assert.match(accountTypePolicy, /ledger:[\s\S]*ownerSigningPath: "ledger"/);
  assert.match(accountTypePolicy, /ledger:[\s\S]*feeTokenExecution: false/);
  assert.match(ownerAuthorization, /signLedgerTypedDataForAccount\(/);
  assert.match(safeExecution, /signAndBroadcastLedgerTransaction\(/);
  assert.match(safeExecution, /canExecuteSafeWithFeeToken\(/);
  assert.match(safeUi, /HardwareAccountSigningStatus/);
  assert.match(safeUi, /isLedgerWaiting/);
});
