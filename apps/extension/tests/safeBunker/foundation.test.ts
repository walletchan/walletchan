import assert from "node:assert/strict";
import test from "node:test";
import { deriveBunkerChainOwner } from "../../src/chrome/safeBunker/chainOwnerDerivation";
import { deriveBunkerOwner } from "../../src/chrome/safeBunker/derivation";
import { encryptBunkerState, decryptBunkerState } from "../../src/chrome/safeBunker/crypto";
import { decodeBunkerDraftVault, BUNKER_DRAFT_VAULT_KEY } from "../../src/chrome/safeBunker/record";
import { importVaultKey } from "../../src/chrome/cryptography/vaultKey";
const phrase = `${"abandon ".repeat(11)}about`;
test("master-derived owners and journal encryption authenticate source, chain and revision", async () => {
  const key = await importVaultKey(crypto.getRandomValues(new Uint8Array(32)));
  const owner = deriveBunkerChainOwner(phrase, 84532, 0);
  const entry = { header: { id: `bunker-source:84532:${owner}`, name: "Bunker", seedGroupId: "group", chainId: 84532, derivationVersion: 2 as const, firstOwner: owner, createdAt: 1 } };
  const journal = await encryptBunkerState(entry, key, 1, { secret: "journal" });
  assert.deepEqual(await decryptBunkerState(entry, key, 1, journal), { secret: "journal" });
  assert.notDeepEqual(await encryptBunkerState(entry, key, 1, { secret: "journal" }), journal);
  await assert.rejects(decryptBunkerState(entry, key, 2, journal));
  await assert.rejects(decryptBunkerState({ header: { ...entry.header, seedGroupId: "other" } }, key, 1, journal));
  await assert.rejects(decryptBunkerState({ header: { ...entry.header, chainId: 1 } }, key, 1, journal));
  const value = { version: 2, entries: [entry] };
  assert.deepEqual(decodeBunkerDraftVault(value), value);
  for (const invalid of [null, { version: 1, entries: [] }, { ...value, entries: [entry, entry] },
    { ...value, sources: [] }, { ...value, entries: [{ header: { ...entry.header, chainId: 1 } }] }])
    assert.throws(() => decodeBunkerDraftVault(invalid));
});

test("shared phrase lifecycle supports zero EOA accounts, backup, agent restrictions and factor changes", { timeout: 120000 }, async t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "chrome");
  const local: Record<string, any> = {}, sync: Record<string, any> = { autoLockTimeout: 900000 }, session: Record<string, any> = {};
  const area = (data: Record<string, any>) => ({
    async get(keys: any = null, callback?: (v: any) => void) { const names = keys === null ? Object.keys(data) : typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys); const value = structuredClone(Object.fromEntries(names.map((k: string) => [k, data[k]]))); callback?.(value); return value; },
    async set(value: any) { Object.assign(data, structuredClone(value)); },
    async remove(keys: string | string[]) { for (const key of typeof keys === "string" ? [keys] : keys) delete data[key]; },
    async clear() { for (const key of Object.keys(data)) delete data[key]; },
  });
  Object.defineProperty(globalThis, "chrome", { configurable: true, value: { runtime: { getURL: (p: string) => `chrome-extension://test${p}`, sendMessage: async () => {}, lastError: undefined }, storage: { local: area(local), sync: area(sync), session: area(session) } } });
  try {
    const cache = await import("../../src/chrome/sessionCache"), auth = await import("../../src/chrome/authHandlers");
    const { generateVaultKey, encryptVaultKey } = await import("../../src/chrome/crypto");
    const { saveSeedPhraseOnly } = await import("../../src/chrome/mnemonic/savePhraseOnly");
    const { createBunkerDraft } = await import("../../src/chrome/safeBunker/drafts");
    const { assertBunkerDraftIntegrity } = await import("../../src/chrome/safeBunker/integrity");
    const { getSeedGroups, removeSeedGroup } = await import("../../src/chrome/accountStorage");
    const { removeMnemonic } = await import("../../src/chrome/mnemonic/operations");
    const { withBunkerDraftSeed } = await import("../../src/chrome/safeBunker/crypto");
    const password = "synthetic-bunker-shared-master", raw = generateVaultKey(), key = await importVaultKey(raw);
    local.encryptedVaultKeyMaster = await encryptVaultKey(raw, password);
    local.accounts = [{ id: "existing", type: "impersonator", address: "0x1111111111111111111111111111111111111111", createdAt: 1 }];
    const unlock = (role: "master" | "agent" = "master") => { cache.setCachedVaultKey(key); cache.setCachedPasswordDirect(role === "master" ? password : null); cache.setCachedPasswordType(role); };
    unlock();
    const group = await saveSeedPhraseOnly({ generate: false, mnemonic: phrase });
    const [base, eth] = await Promise.all([createBunkerDraft(group.id, 84532), createBunkerDraft(group.id, 11155111)]);
    await t.test("normal mnemonic group has zero EOAs; duplicate imports and chain bindings are idempotent", async () => {
      assert.equal(group.accountCount, 0); assert.equal(local.accounts.length, 1);
      assert.equal(local.mnemonicVault.entries[0].id, group.id);
      assert.equal((await saveSeedPhraseOnly({ generate: false, mnemonic: phrase })).id, group.id);
      assert.equal((await createBunkerDraft(group.id, 84532)).id, base.id);
      assert.notEqual(base.firstOwner, eth.firstOwner);
      assert.equal(local[BUNKER_DRAFT_VAULT_KEY].sources, undefined);
      assert.equal(local[BUNKER_DRAFT_VAULT_KEY].entries.length, 2);
      assert.ok(!JSON.stringify(local).includes(phrase));
      assert.ok(!JSON.stringify(local).includes("xprv"));
      await assertBunkerDraftIntegrity(key);
      await assert.rejects(removeMnemonic(group.id), /used by Safe Bunker/);
      await assert.rejects(removeSeedGroup(group.id), /used by Safe Bunker/);
    });
    await t.test("agents cannot access Bunker derivation, source management or phrase reveal", async () => {
      unlock("agent"); await assert.rejects(createBunkerDraft(group.id, 1), /Authentication changed/);
      await assert.rejects(saveSeedPhraseOnly({ generate: true, mnemonic: "" }), /master/);
      const entry = local[BUNKER_DRAFT_VAULT_KEY].entries.find((e: any) => e.header.id === base.id);
      await assert.rejects(withBunkerDraftSeed(entry, key, root => deriveBunkerOwner(root, 84532, 0)), /Authentication changed/);
      const { handleRevealSeedPhrase } = await import("../../src/chrome/secrets/revealHandlers");
      let result: any; await handleRevealSeedPhrase(group.id, password, value => { result = value; });
      assert.equal(result.success, false); assert.equal(result.mnemonic, undefined); unlock();
    });
    await t.test("source access rejects a late result after master authority changes", async () => {
      const { withBunkerSourcePhrase } = await import("../../src/chrome/safeBunker/sources");
      const { invalidateAuthCeremonies } = await import("../../src/chrome/authTransition");
      await assert.rejects(withBunkerSourcePhrase(group.id, async () => {
        invalidateAuthCeremonies(); unlock(); return "late result";
      }));
      unlock();
    });
    await t.test("ordinary deferred backup covers a generated zero-EOA source", async () => {
      const generated = await saveSeedPhraseOnly({ generate: true, mnemonic: "" });
      assert.equal(generated.backupPending, true); assert.equal(generated.accountCount, 0);
      await createBunkerDraft(generated.id, 84532);
      const { confirmSeedBackup } = await import("../../src/chrome/mnemonic/backup");
      assert.equal((await confirmSeedBackup(generated.id)).success, true);
      assert.equal((await getSeedGroups()).find(g => g.id === generated.id)?.backupPending, undefined);
    });
    await t.test("password and biometric transitions retain master-only source access without duplicating secrets", async () => {
      const before = structuredClone(local[BUNKER_DRAFT_VAULT_KEY]);
      assert.equal((await auth.handleChangePassword(password, "new-shared-bunker-master")).success, true);
      assert.deepEqual(local[BUNKER_DRAFT_VAULT_KEY], before);
      assert.equal((await auth.handleUnlockWallet("new-shared-bunker-master")).success, true);
      await assertBunkerDraftIntegrity(key);
      const passkey = await import("../../src/chrome/passkeyUnlock"), transitions = await import("../../src/chrome/authTransition");
      const material = { credentialId: Buffer.alloc(64, 0x31).toString("base64url"), prfSalt: Buffer.alloc(32, 0x32).toString("base64url"), prfKeyMaterial: Buffer.alloc(32, 0x33).toString("base64url"), authCeremonyEpoch: transitions.getAuthCeremonyEpoch() };
      const setup = await passkey.handleSetupPasskeyUnlockWithPassword(material, "new-shared-bunker-master");
      assert.equal(setup.success, true, setup.error); cache.clearInMemoryAuthCache();
      const result = await passkey.handleUnlockWithPasskey({ ...material, authCeremonyEpoch: transitions.getAuthCeremonyEpoch() });
      assert.equal(result.success, true, result.error); assert.deepEqual(local[BUNKER_DRAFT_VAULT_KEY], before);
    });
    await t.test("seed cleanup counts regular and Bunker accounts together across chains", async () => {
      const { cleanupRemovedSeedAccount } = await import("../../src/chrome/accounts/seedRemoval");
      const { deriveSeedAccounts } = await import("../../src/chrome/mnemonic/accountHandlers");
      const { handleRemoveAccount } = await import("../../src/chrome/transactions/accountMutations");
      for (const regularFirst of [true, false]) {
        const source = await saveSeedPhraseOnly({ generate: true, mnemonic: "" });
        const { withBunkerSourcePhrase } = await import("../../src/chrome/safeBunker/sources");
        const savedPhrase = await withBunkerSourcePhrase(source.id, phrase => phrase);
        const drafts = await Promise.all([createBunkerDraft(source.id, 84532), createBunkerDraft(source.id, 11155111)]);
        const derived = await deriveSeedAccounts({ seedGroupId: source.id, indices: [0] });
        assert.equal(derived.success, true, derived.error);
        const eoa = local.accounts.find((a: any) => a.type === "seedPhrase" && a.seedGroupId === source.id);
        const bunkers = drafts.map((d, i) => ({ id: `test-bunker-${source.id}-${i}`, type: "safeBunker", bunkerId: d.id,
          seedGroupId: source.id, chainId: i ? 11155111 : 84532, derivationVersion: 2, address: `0x${String(i + 2).repeat(40)}`, createdAt: 1 }));
        local.accounts.push(...bunkers);
        const assertSource = (present: boolean) => {
          assert.equal(local.seedGroups.some((g: any) => g.id === source.id), present);
          assert.equal(local.mnemonicVault.entries.some((e: any) => e.id === source.id), present);
        };
        if (regularFirst) {
          const removed = await handleRemoveAccount(eoa.id);
          assert.equal(removed.success, true, removed.error); assertSource(true);
          assert.equal(local.seedGroups.find((g: any) => g.id === source.id).accountCount, 0);
        }
        for (const bunker of bunkers) {
          await cleanupRemovedSeedAccount(source.id, { remainingAccounts: local.accounts.filter((a: any) => a.id !== bunker.id), bunkerId: bunker.bunkerId });
          assert.ok(!local.safeBunkerBindingsV2.entries.some((e: any) => e.header.id === bunker.bunkerId));
          assertSource(!regularFirst || bunker !== bunkers[1]);
        }
        if (!regularFirst) {
          const removed = await handleRemoveAccount(eoa.id);
          assert.equal(removed.success, true, removed.error); assertSource(false);
        }
        assert.ok(!local.safeBunkerBindingsV2.entries.some((e: any) => e.header.seedGroupId === source.id));
        const reimported = await saveSeedPhraseOnly({ generate: false, mnemonic: savedPhrase });
        assert.notEqual(reimported.id, source.id);
        const rediscovered = await createBunkerDraft(reimported.id, 84532);
        assert.equal(rediscovered.id, drafts[0].id);
        assert.equal(rediscovered.seedGroupId, reimported.id);
        await assertBunkerDraftIntegrity(key);
        await cleanupRemovedSeedAccount(reimported.id);
      }
    });
    await t.test("source corruption and orphaned phrase references fail closed", async () => {
      const saved = structuredClone(local[BUNKER_DRAFT_VAULT_KEY]);
      local[BUNKER_DRAFT_VAULT_KEY].entries[0].header.seedGroupId = "missing-group";
      await assert.rejects(assertBunkerDraftIntegrity(key)); local[BUNKER_DRAFT_VAULT_KEY] = saved;
      const groups = local.seedGroups; local.seedGroups = [];
      await assert.rejects(assertBunkerDraftIntegrity(key)); local.seedGroups = groups;
      await assertBunkerDraftIntegrity(key);
    });
  } finally { if (original) Object.defineProperty(globalThis, "chrome", original); else Reflect.deleteProperty(globalThis, "chrome"); }
});
