import assert from "node:assert/strict";
import test from "node:test";
import { submitOnboardingAccount } from "../../src/pages/onboarding/onboardingSubmission";

const address = `0x${"11".repeat(20)}`;
const group = { id: "source", name: "Seed", accountCount: 0, createdAt: 1 };
const account = { id: "bunker", type: "safeBunker", seedGroupId: group.id, address, displayName: "SafeBunker - Base", chainId: 8453 };
function setup(options: { agent?: boolean; saveFailure?: boolean; wrongAccount?: boolean; cancelled?: boolean } = {}) {
  const messages: any[] = [], writes: any[] = [];
  Object.defineProperty(globalThis, "chrome", { configurable: true, value: {
    runtime: { sendMessage: async (message: any) => {
      messages.push(message);
      if (message.type === "beginOnboardingInitialization") return { success: true, initializationId: "owner" };
      if (message.type === "initializeOnboardingCredential") return { success: true, passwordType: options.agent ? "agent" : "master" };
      if (message.type === "saveSeedPhraseOnly") return options.saveFailure ? { success: false, error: "Could not save" } : { success: true, group };
      if (message.type === "getAccounts") return [{ ...account, ...(options.wrongAccount ? { seedGroupId: "other" } : {}) }];
      return { success: true };
    } }, storage: { sync: { set: async (value: any) => { writes.push(value); }, get: async () => ({ isArcBrowser: true }) } },
  } });
  return { messages, writes, input: {
    accountType: "safeBunker" as const, initializationOwnerId: "owner", password: "a long password", apiKey: "", walletAddress: "", bankrDisplayName: "",
    privateKey: "", privateKeyDisplayName: "", viewOnlyAddress: "", viewOnlyDisplayName: "", mnemonic: "test test test test test test test test test test test junk",
    seedIndices: [], seedGroupName: "", seedAccountDisplayName: "", ledgerSelection: null, trezorSelection: null, resolveAddress: async () => null,
    importBunkers: async (saved: any) => {
      assert.equal(saved.id, group.id);
      assert.equal(messages.at(-1).type, "saveSeedPhraseOnly", "discovery begins only after the phrase has been saved");
      if (options.cancelled) throw new Error("cancelled");
      // The shared import UI calls verified addExistingSafeBunker before resolving this choice.
      return { accountId: account.id, chainId: account.chainId };
    },
  } };
}

test("Bunker import secures only the phrase, uses verified imported accounts and selects their chain", async () => {
  const h = setup(); await submitOnboardingAccount(h.input);
  assert.deepEqual(h.messages.slice(0, 6).map(message => message.type), ["beginOnboardingInitialization", "initializeOnboardingCredential", "saveSeedPhraseOnly", "getAccounts", "setActiveAccount", "completeOnboardingInitialization"]);
  assert.equal(h.messages.find(message => message.type === "saveSeedPhraseOnly").generate, false);
  assert.equal(h.writes[0].address, address); assert.equal(h.writes[0].chainName, "Base");
  assert.equal(h.messages.some(message => /addSeedPhraseGroup|createOnboardingSeedAccount|deploySafeBunker|createSafeBunkerDraft|addPrivateKey/.test(message.type)), false);
});
for (const option of [{ agent: true }, { saveFailure: true }, { wrongAccount: true }, { cancelled: true }]) {
  test(`failed or cancelled Bunker onboarding uses the owned rollback: ${JSON.stringify(option)}`, async () => {
    const h = setup(option); await assert.rejects(submitOnboardingAccount(h.input));
    assert.equal(h.messages.at(-1).type, "rollbackOnboardingInitialization");
    assert.equal(h.messages.some(message => message.type === "completeOnboardingInitialization"), false);
    assert.equal(h.writes.length, 0);
  });
}
test("a Bunker phrase and selection flow are required before creating credentials", async () => {
  const h = setup(); await assert.rejects(submitOnboardingAccount({ ...h.input, importBunkers: undefined }));
  assert.equal(h.messages.length, 0);
});
