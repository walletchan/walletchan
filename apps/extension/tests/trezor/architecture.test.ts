import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const extensionRoot = new URL("../../", import.meta.url);

const source = (path: string) => readFile(new URL(path, extensionRoot), "utf8");

test("Connect 10 runs only in the background; Ledger retains the offscreen document", async () => {
  const [
    pkg,
    sdk,
    adapter,
    offscreen,
    manifest,
    firefoxManifest,
    backgroundBuild,
  ] = await Promise.all([
    source("package.json"),
    source("src/chrome/trezor/connectSdk.ts"),
    source("src/chrome/trezor/connectAdapter.ts"),
    source("src/offscreen/offscreen.ts"),
    source("public/manifest.json"),
    source("manifest.firefox.json"),
    source("vite.config.background.ts"),
  ]);
  assert.equal(JSON.parse(pkg).dependencies["@trezor/connect-web"], "10.0.1");
  assert.match(sdk, /from "@trezor\/connect-web"/);
  assert.match(adapter, /env: "webextension"/);
  assert.match(adapter, /coreMode: "auto"/);
  assert.doesNotMatch(offscreen, /trezor/i);
  assert.deepEqual(JSON.parse(manifest).externally_connectable.matches, [
    "https://suite.trezor.io/*",
  ]);
  assert.equal(JSON.parse(firefoxManifest).externally_connectable, undefined);
  assert.equal(
    JSON.parse(manifest).content_scripts.some((entry: { js: string[] }) =>
      entry.js.some((script) => script.includes("trezor")),
    ),
    false,
  );
  assert.match(backgroundBuild, /firefox-trezor-release-boundary/);
  assert.match(
    backgroundBuild,
    /Trezor transport leaked into Firefox background/,
  );
});

test("store packaging replaces same-version archives and keeps Firefox Trezor-free", async () => {
  const [packageText, firefoxPackaging, backgroundBuild] = await Promise.all([
    source("package.json"),
    source("scripts/swap-manifest.mjs"),
    source("vite.config.background.ts"),
  ]);
  const scripts = JSON.parse(packageText).scripts as Record<string, string>;

  assert.match(scripts.zip, /rm -f zip\/walletchan-v/);
  assert.match(scripts["zip:cws"], /rm -f cws-zip\/walletchan-v/);
  assert.match(scripts["zip:firefox"], /rm -f zip\/walletchan-firefox-v/);
  assert.match(
    firefoxPackaging,
    /rmSync\(trezorVendorDirectory,[\s\S]+recursive: true/,
  );
  assert.match(
    firefoxPackaging,
    /readdirSync\(vendorDirectory\)\.length === 0/,
  );
  assert.match(backgroundBuild, /compactGeneratedBackground/);
  assert.match(backgroundBuild, /compress: false/);
  assert.match(backgroundBuild, /mangle: false/);
});

test("Trezor operations retain bounded validation and canonical identity checks", async () => {
  const [sdk, validation, client] = await Promise.all([
    source("src/chrome/trezor/connectAdapter.ts"),
    source("src/chrome/trezor/connectValidation.ts"),
    source("src/chrome/trezor/connectClient.ts"),
  ]);
  assert.match(sdk, /TREZOR_DEVICE_IDENTITY_PATH/);
  assert.match(sdk, /await assertExpectedDevice/);
  assert.match(sdk, /captureDeviceBinding/);
  assert.match(validation, /serializedJsonLength/);
  assert.match(validation, /MAX_SIGNATURE_PAYLOAD_CHARS/);
  assert.match(client, /DISCOVERY_TIMEOUT_MS = 90_000/);
  assert.match(client, /SIGNING_TIMEOUT_MS = 10 \* 60_000/);
});

test("Trezor account setup is master-gated, atomic, reset-aware, and UI-only", async () => {
  const [types, storage, handlers, router, policy, reset, composition] =
    await Promise.all([
      source("src/chrome/types.ts"),
      source("src/chrome/trezor/storage.ts"),
      source("src/chrome/trezor/accountHandlers.ts"),
      source("src/chrome/background/trezorRouter.ts"),
      source("src/chrome/background/messageAccessPolicy.ts"),
      source("src/chrome/storage/resetManifest.ts"),
      source("src/chrome/background/composition/accountRoutes.ts"),
    ]);
  assert.match(types, /interface TrezorAccount/);
  assert.match(types, /type: "trezor"/);
  assert.match(storage, /TREZOR_DEVICES_STORAGE_KEY = "trezorDevices"/);
  assert.match(storage, /decodeTrezorAccount/);
  assert.match(storage, /decodeTrezorDeviceMap/);
  assert.match(storage, /withStorageLock\(ACCOUNTS_LOCK_KEY/);
  assert.match(
    storage,
    /\[ACCOUNTS_STORAGE_KEY\]: prepared\.accounts,[\s\S]+\[TREZOR_DEVICES_STORAGE_KEY\]: prepared\.devices/,
  );
  assert.match(handlers, /passwordType !== "master"/);
  assert.match(handlers, /WALLET_SECRET_OPERATION_LOCK_KEY/);
  assert.deepEqual(
    [...router.matchAll(/^\s+"([^"]+)",?$/gm)].map((match) => match[1]),
    [
      "trezorConnect",
      "trezorScan",
      "trezorCancel",
      "addTrezorAccounts",
      "getTrezorDevices",
    ],
  );
  for (const type of [
    "trezorConnect",
    "trezorScan",
    "trezorCancel",
    "addTrezorAccounts",
    "getTrezorDevices",
  ]) {
    assert.match(policy, new RegExp(`"${type}"`));
  }
  assert.match(reset, /"trezorDevices"/);
  assert.match(composition, /createBackgroundTrezorMessageRouter/);
});

test("Trezor setup and identity use shared hardware UI with local official assets", async () => {
  const [
    route,
    app,
    setup,
    flow,
    sharedFlow,
    adapter,
    details,
    logo,
    wordmark,
    symbol,
  ] = await Promise.all([
    source("src/app/trezorSetupRoute.ts"),
    source("src/App.tsx"),
    source("src/components/Trezor/TrezorSetupScreen.tsx"),
    source("src/components/Trezor/AddTrezorFlow.tsx"),
    source("src/components/HardwareWallet/AddHardwareWalletFlow.tsx"),
    source("src/components/Trezor/trezorFlowAdapter.ts"),
    source("src/components/HardwareWallet/HardwareAccountDetails.tsx"),
    source("src/components/Trezor/TrezorLogo.tsx"),
    source("public/trezor-wordmark.svg"),
    source("public/trezor-symbol.svg"),
  ]);
  assert.match(route, /openHardwareSetupTab\("trezor"\)/);
  assert.match(app, /TrezorSetupScreen/);
  assert.match(setup, /HardwareWalletSetupShell/);
  assert.match(flow, /AddHardwareWalletFlow/);
  assert.doesNotMatch(flow, /@trezor\/connect/);
  assert.doesNotMatch(adapter, /@trezor\/connect/);
  assert.match(adapter, /type: "trezorConnect"/);
  assert.match(adapter, /type: "trezorScan"/);
  assert.match(adapter, /type: "addTrezorAccounts"/);
  assert.match(adapter, /type: "trezorCancel"/);
  assert.match(adapter, /trezorStatus/);
  assert.match(adapter, /Trezor Suite/);
  assert.doesNotMatch(adapter, /Ethereum app/);
  assert.match(logo, /HardwareWalletLogo/);
  assert.match(sharedFlow, /activeOperationId/);
  assert.match(sharedFlow, /provider\.operations\.cancel/);
  assert.match(details, /getTrezorDevices/);
  assert.match(details, /account\.hdPath/);
  assert.match(details, /account\.hdIndex/);
  assert.match(wordmark, /<svg/);
  assert.match(symbol, /<svg/);
});

test("Trezor transaction and signature paths recover exact signers before release", async () => {
  const [signing, transaction, signature, txRouter, secretRouter, txUi, sigUi] =
    await Promise.all([
      source("src/chrome/trezor/signing.ts"),
      source("src/chrome/ledger/transactionExecution.ts"),
      source("src/chrome/ledger/signatureConfirmation.ts"),
      source("src/chrome/background/transactionExecutionRouter.ts"),
      source("src/chrome/background/secretManagementRouter.ts"),
      source(
        "src/components/TransactionConfirmation/TransactionActionNotice.tsx",
      ),
      source(
        "src/components/SignatureConfirmation/SignatureRequestConfirmation.tsx",
      ),
    ]);
  assert.match(signing, /buildTrezorTransactionPayload/);
  assert.match(signing, /EIP-2930-only transactions are not supported/);
  assert.match(
    signing,
    /deviceSerialized\.toLowerCase\(\) !== reconstructed\.toLowerCase\(\)/,
  );
  assert.match(signing, /recoverTransactionAddress/);
  assert.match(signing, /recoverMessageAddress/);
  assert.match(signing, /hashTypedData/);
  assert.match(signing, /hashDomain/);
  assert.match(signing, /hashStruct/);
  assert.match(signing, /recoverAddress/);
  assert.match(transaction, /signAndBroadcastTrezorTransaction/);
  assert.match(transaction, /beforeBroadcast/);
  assert.match(transaction, /latest\.deviceId !== account\.deviceId/);
  assert.match(transaction, /enforcePendingRequestAuthorizationAtConfirmation/);
  assert.match(signature, /signTrezorSignatureRequest/);
  assert.match(signature, /revalidatePendingSignatureBeforeRelease/);
  assert.match(txRouter, /confirmTransactionAsyncTrezor/);
  assert.match(secretRouter, /pinnedType === "trezor"/);
  assert.match(txUi, /<HardwareAccountSigningStatus/);
  assert.match(sigUi, /<HardwareAccountSigningStatus/);
});

test("Trezor Safe and Privacy paths reuse the exact hardware signer while excluded modes fail closed", async () => {
  const [
    capabilities,
    safeOwner,
    safeExecution,
    privacyPolicy,
    ragequit,
    batch,
    swap,
    walletConnect,
  ] = await Promise.all([
    source("src/chrome/hardware/accountCapabilities.ts"),
    source("src/chrome/safe/ownerAuthorization.ts"),
    source("src/chrome/safe/execution.ts"),
    source("src/chrome/privacy/deployment/accountPolicy.ts"),
    source("src/chrome/privacy/ragequit/prepare.ts"),
    source("src/chrome/batch/batchRequestIntake.ts"),
    source("src/chrome/transactions/swaps/direct.ts"),
    source("src/chrome/walletConnect/sessionAccountPolicy.ts"),
  ]);
  assert.match(
    capabilities,
    /trezor:[\s\S]+signingTransport: "trezor"[\s\S]+erc5792Batch: false[\s\S]+eip7702: false[\s\S]+feeTokenExecution: false/,
  );
  assert.match(safeOwner, /signTrezorTypedDataForAccount/);
  assert.match(safeExecution, /signAndBroadcastTrezorTransaction/);
  assert.match(privacyPolicy, /privacyPoolsSingleTransaction/);
  assert.match(
    ragequit,
    /first\.accountType === "ledger" \|\| first\.accountType === "trezor"/,
  );
  assert.doesNotMatch(batch, /isTrezorAccount/);
  assert.match(swap, /getAccountTypeCapabilities\(account\.type\)\.directSwap/);
  assert.match(walletConnect, /getAccountTypeCapabilities\(account\.type\)/);
  assert.match(walletConnect, /capabilities\.personalSign/);
  assert.match(walletConnect, /capabilities\.typedDataSign/);
});
