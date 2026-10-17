import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (path: string) =>
  readFile(new URL(`../../src/components/${path}`, import.meta.url), "utf8");

test("shared hardware presentation remains provider-configured and effect-free", async () => {
  const sources = await Promise.all(
    [
      "HardwareWallet/HardwareWalletLogo.tsx",
      "HardwareWallet/HardwareWalletAvatar.tsx",
      "HardwareWallet/HardwareWalletDevicePanel.tsx",
      "HardwareWallet/HardwareWalletDerivationPicker.tsx",
      "HardwareWallet/HardwareWalletSigningStatus.tsx",
      "HardwareWallet/HardwareWalletSetupShell.tsx",
    ].map(readSource),
  );

  for (const source of sources) {
    assert.doesNotMatch(source, /\b(?:chrome\.|navigator\.|fetch\s*\()/);
    assert.doesNotMatch(source, /\b(?:Ledger|Trezor)\b/);
  }
});

test("the shared add-account controller owns provider-independent flow state", async () => {
  const source = await readSource(
    "HardwareWallet/AddHardwareWalletFlow.tsx",
  );

  assert.doesNotMatch(source, /\b(?:Ledger|Trezor|navigator\.hid)\b/);
  assert.match(source, /provider\.operations\.connect\(opId\)/);
  assert.match(source, /provider\.operations\.scan\(\{/);
  assert.match(source, /provider\.operations\.commitAccounts\(selection\)/);
  assert.match(source, /const opId = crypto\.randomUUID\(\)/);
  assert.match(source, /subscribeStatus\(\s*opId/);
  assert.match(source, /provider\.operations\.cancel\?\.\(opId\)/);
  assert.match(source, /account\.type !== "impersonator"/);
  assert.match(source, /count: 5/);
  assert.match(source, /Load 5 more/);
});

test("Ledger presentation delegates to the shared hardware components", async () => {
  const adapters = {
    "LedgerLogo.tsx": "HardwareWalletLogo",
    "LedgerAvatar.tsx": "HardwareWalletAvatar",
    "LedgerDevicePanel.tsx": "HardwareWalletDevicePanel",
    "LedgerDerivationPicker.tsx": "HardwareWalletDerivationPicker",
    "LedgerSigningStatus.tsx": "HardwareWalletSigningStatus",
    "LedgerSetupScreen.tsx": "HardwareWalletSetupShell",
  };

  for (const [file, sharedComponent] of Object.entries(adapters)) {
    const source = await readSource(`Ledger/${file}`);
    assert.match(source, new RegExp(`import \\{ ${sharedComponent} \\}`));
    assert.match(source, new RegExp(`<${sharedComponent}`));
  }
});

test("Ledger copy and derivation layouts remain provider-owned", async () => {
  const [devicePanel, derivation, signingStatus] = await Promise.all([
    readSource("Ledger/LedgerDevicePanel.tsx"),
    readSource("Ledger/ledgerDerivation.ts"),
    readSource("Ledger/LedgerSigningStatus.tsx"),
  ]);

  assert.match(devicePanel, /The Ethereum app is ready\./);
  assert.match(devicePanel, /Chrome will ask for USB access\./);
  assert.match(derivation, /m\/44'\/60'\/n'\/0\/0/);
  assert.match(derivation, /m\/44'\/60'\/0'\/0\/n/);
  assert.match(derivation, /m\/44'\/60'\/0'\/n/);
  assert.match(signingStatus, /Sign the request in your Ledger/);
});

test("Ledger keeps WebHID and trusted messages inside its provider adapter", async () => {
  const [flow, adapter] = await Promise.all([
    readSource("Ledger/AddLedgerFlow.tsx"),
    readSource("Ledger/ledgerFlowAdapter.ts"),
  ]);

  assert.match(flow, /<AddHardwareWalletFlow/);
  assert.doesNotMatch(flow, /\b(?:chrome\.|navigator\.)/);
  assert.match(adapter, /navigator as Navigator/);
  assert.match(adapter, /vendorId: 0x2c97/);
  assert.match(adapter, /type: "ledgerConnect"/);
  assert.match(adapter, /type: "ledgerScan"/);
  assert.match(adapter, /type: "addLedgerAccounts"/);
  assert.match(adapter, /type: "ledgerCancel"/);
  assert.match(adapter, /type === "offscreenLedgerStatus"/);
});

test("Trezor presentation and setup delegate to the shared hardware components", async () => {
  const adapters = {
    "TrezorLogo.tsx": "HardwareWalletLogo",
    "TrezorAvatar.tsx": "HardwareWalletAvatar",
    "TrezorSigningStatus.tsx": "HardwareWalletSigningStatus",
    "TrezorSetupScreen.tsx": "HardwareWalletSetupShell",
  };
  for (const [file, sharedComponent] of Object.entries(adapters)) {
    const source = await readSource(`Trezor/${file}`);
    assert.match(source, new RegExp(`import \\{ ${sharedComponent} \\}`));
    assert.match(source, new RegExp(`<${sharedComponent}`));
  }

  const [flow, adapter, derivation] = await Promise.all([
    readSource("Trezor/AddTrezorFlow.tsx"),
    readSource("Trezor/trezorFlowAdapter.ts"),
    readSource("Trezor/trezorDerivation.ts"),
  ]);
  assert.match(flow, /<AddHardwareWalletFlow/);
  assert.doesNotMatch(flow, /@trezor\/connect/);
  assert.match(adapter, /type: "trezorConnect"/);
  assert.match(adapter, /type: "trezorScan"/);
  assert.match(adapter, /type: "addTrezorAccounts"/);
  assert.match(adapter, /type: "trezorCancel"/);
  assert.match(adapter, /type === "trezorStatus"/);
  assert.doesNotMatch(adapter, /Ethereum app/);
  assert.match(derivation, /m\/44'\/60'\/\{index\}'\/0\/0/);
  assert.match(derivation, /m\/44'\/60'\/0'\/0\/\{index\}/);
  assert.match(derivation, /m\/44'\/60'\/0'\/\{index\}/);
});
