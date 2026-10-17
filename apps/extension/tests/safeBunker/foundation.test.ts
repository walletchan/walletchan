import assert from "node:assert/strict";
import test from "node:test";
import { HDNodeWallet } from "ethers";
import { deriveBunkerOwner, generateBunkerSeed, assertBunkerSeed } from "../../src/chrome/safeBunker/derivation";
import { encryptBunkerDraft, withBunkerDraftSeed } from "../../src/chrome/safeBunker/crypto";
import { decodeBunkerDraftVault, BUNKER_DRAFT_VAULT_KEY } from "../../src/chrome/safeBunker/record";
import { importVaultKey } from "../../src/chrome/cryptography/vaultKey";

// Public BIP39 vector; never production recovery material.
const seed = `${"abandon ".repeat(11)}about`;
const id = "bunker-draft:11111111-1111-4111-8111-111111111111";
const header = { id, name: "Test Bunker", chainId: 11155111 as const,
  derivationVersion: 1 as const, firstOwner: deriveBunkerOwner(seed, 0), createdAt: 1 };

test("fully hardened derivation agrees with independent ethers implementation", () => {
  for (const index of [0, 1, 255, 256, 2147483647]) {
    const expected = HDNodeWallet.fromPhrase(seed, "", `m/44'/60'/0'/0'/${index}'`).address.toLowerCase();
    assert.equal(deriveBunkerOwner(seed, index), expected);
  }
  assert.notEqual(deriveBunkerOwner(seed, 0), deriveBunkerOwner(seed, 1));
  for (const index of [-1, 0.1, NaN, Infinity, 2147483648]) assert.throws(() => deriveBunkerOwner(seed, index));
});

test("Bunker seeds use exactly 12 words and reject other BIP39 lengths", () => {
  assertBunkerSeed(seed);
  for (let i = 0; i < 8; i++) {
    const generated = generateBunkerSeed();
    assert.equal(generated.split(" ").length, 12);
    assertBunkerSeed(generated);
  }
  // Valid public BIP39 vectors at other lengths must not be accepted.
  for (const phrase of [
    `${"abandon ".repeat(14)}address`,
    `${"abandon ".repeat(17)}agent`,
    `${"abandon ".repeat(20)}admit`,
    `${"abandon ".repeat(23)}art`,
    "abandon ".repeat(12).trim(),
  ]) {
    assert.throws(() => assertBunkerSeed(phrase));
    assert.throws(() => deriveBunkerOwner(phrase, 0));
  }
});

test("seed and key wrapping authenticate identity, purpose and exact key", async () => {
  const key = await importVaultKey(crypto.getRandomValues(new Uint8Array(32)));
  const other = await importVaultKey(crypto.getRandomValues(new Uint8Array(32)));
  const entry = await encryptBunkerDraft(header, seed, key);
  assert.equal(await withBunkerDraftSeed(entry, key, (phrase) => phrase), seed);
  assert.equal(JSON.stringify(entry).includes("abandon"), false);
  await assert.rejects(withBunkerDraftSeed(entry, other, () => true));
  for (const changed of [
    { ...entry, header: { ...header, name: "Changed" } },
    { ...entry, header: { ...header, createdAt: 2 } },
    { ...entry, seed: entry.wrappedKey },
  ]) await assert.rejects(withBunkerDraftSeed(changed, key, () => true));
  assert.deepEqual(decodeBunkerDraftVault(undefined), { version: 1, entries: [] });
  assert.deepEqual(decodeBunkerDraftVault({ version: 1, entries: [entry] }).entries, [entry]);
  for (const value of [null, {}, { version: 2, entries: [] },
    { version: 1, entries: [entry, entry] }, { version: 1, entries: [], extra: true },
    { version: 1, entries: [{ ...entry, wrappedKey: { iv: "bad", ciphertext: "bad" } }] },
    { version: 1, entries: Array(101).fill(entry) }]) assert.throws(() => decodeBunkerDraftVault(value));
});

test("draft lifecycle preserves secrets and auth boundaries", async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "chrome");
  const local: Record<string, any> = {};
  const sync: Record<string, any> = { autoLockTimeout: 900000 };
  const nativeSession: Record<string, any> = {};
  let writes = 0;
  let failWrite = false;
  let afterGet: ((keys: string[]) => void) | undefined;
  const area = (data: Record<string, any>, isLocal = false) => ({
    async get(keys: string | string[] | Record<string, unknown> | null = null, callback?: (v: any) => void) {
      const names = keys === null ? Object.keys(data) : typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      const selected = structuredClone(Object.fromEntries(names.map((key) => [key, data[key]])));
      if (isLocal) afterGet?.(names);
      callback?.(selected); return selected;
    },
    async set(value: Record<string, unknown>) {
      if (isLocal && failWrite) throw new Error("Storage unavailable");
      if (isLocal) writes++;
      Object.assign(data, structuredClone(value));
    },
    async remove(keys: string | string[]) { for (const key of typeof keys === "string" ? [keys] : keys) delete data[key]; },
    async clear() { for (const key of Object.keys(data)) delete data[key]; },
  });
  Object.defineProperty(globalThis, "chrome", { configurable: true, value: {
    runtime: { getURL: (path: string) => `chrome-extension://test${path}`, sendMessage: async () => {}, lastError: undefined },
    storage: { local: area(local, true), sync: area(sync), session: area(nativeSession) },
  } });
  try {
    const cache = await import("../../src/chrome/sessionCache");
    const auth = await import("../../src/chrome/authHandlers");
    const transitions = await import("../../src/chrome/authTransition");
    const { createBunkerDraft, listBunkerDrafts } = await import("../../src/chrome/safeBunker/drafts");
    const { assertBunkerDraftIntegrity } = await import("../../src/chrome/safeBunker/integrity");
    const { handleRevealSeedPhrase, handleRevealPrivateKey } = await import("../../src/chrome/secrets/revealHandlers");
    const { routeBackgroundSafeBunkerMessage } = await import("../../src/chrome/background/safeBunkerRouter");
    const { withStorageLock, WALLET_SECRET_OPERATION_LOCK_KEY } = await import("../../src/chrome/storageLock");
    const { encryptVaultKey, generateVaultKey } = await import("../../src/chrome/crypto");
    const { validateGeneralVaultMasterRecovery } = await import("../../src/chrome/vault/generalIntegrity");
    const password = "bunker-test-master-password";
    let raw: Uint8Array;
    let key: CryptoKey;
    const reset = async () => {
      afterGet = undefined; failWrite = false;
      cache.clearInMemoryAuthCache(); transitions.invalidateAuthCeremonies();
      for (const k of Object.keys(local)) delete local[k];
      raw = generateVaultKey(); key = await importVaultKey(raw);
      local.encryptedVaultKeyMaster = await encryptVaultKey(raw, password);
      local.accounts = []; local.seedGroups = [];
      cache.setCachedVaultKey(key); cache.setCachedPasswordType("master");
    };
    const reveal = async (phraseId: string, proof = password) => {
      let result: any;
      await handleRevealSeedPhrase(phraseId, proof, (value) => { result = value; });
      return result;
    };
    const dispatch = (message: any, sender = { url: "chrome-extension://test/index.html", frameId: 0 }) =>
      new Promise<any>((resolve) => routeBackgroundSafeBunkerMessage(message, sender, resolve));

    await t.test("idempotent creation survives duplicate requests and stores no active account/key", async () => {
      await reset();
      const before = writes;
      assert.deepEqual(await listBunkerDrafts(), []);
      assert.equal(writes, before);
      const [a, b] = await Promise.all([createBunkerDraft(id, "My Bunker"), createBunkerDraft(id, "My Bunker")]);
      assert.deepEqual(a, b); assert.equal(writes, before + 1);
      assert.deepEqual(Object.keys(a).sort(), ["chainId", "createdAt", "id", "name"]);
      assert.equal(local.accounts.length, 0); assert.equal(local.pkVault, undefined);
      assert.equal(local.mnemonicVault, undefined); assert.equal(cache.getPrivateKeyFromCache(id), null);
      const recovered = await reveal(id);
      assert.equal(recovered.success, true); assertBunkerSeed(recovered.mnemonic);
      assert.equal(deriveBunkerOwner(recovered.mnemonic, 0), local[BUNKER_DRAFT_VAULT_KEY].entries[0].header.firstOwner);
      assert.equal(JSON.stringify(local).includes(recovered.mnemonic), false);
      assert.equal((await reveal(id, "wrong password")).success, false);
      let secret: any; await handleRevealPrivateKey(id, password, (value) => { secret = value; });
      assert.equal(secret.success, false); assert.equal(secret.privateKey, undefined);
      await assert.rejects(createBunkerDraft(id, "Different"));
    });
    await t.test("write failure permits exact retry without phantom success", async () => {
      await reset(); failWrite = true;
      await assert.rejects(createBunkerDraft(id, "Retry"));
      assert.equal(local[BUNKER_DRAFT_VAULT_KEY], undefined);
      failWrite = false; await createBunkerDraft(id, "Retry");
      assert.equal(local[BUNKER_DRAFT_VAULT_KEY].entries.length, 1);
    });
    await t.test("untrusted senders and agent management/reveal are rejected", async () => {
      await reset(); await createBunkerDraft(id, "Private");
      const before = structuredClone(local);
      for (const url of ["https://evil.example/", "chrome-extension://test/ens-browse.html"])
        assert.equal((await dispatch({ type: "createSafeBunkerDraft", id, name: "Other" }, { url, frameId: 0 })).success, false);
      assert.equal((await dispatch({ type: "listSafeBunkerDrafts", extra: "bad" })).success, false);
      cache.setCachedPasswordType("agent");
      await assert.rejects(createBunkerDraft(id, "Private")); await assert.rejects(listBunkerDrafts());
      assert.equal((await reveal(id)).success, false);
      assert.deepEqual(local, before);
    });
    await t.test("queued work cannot inherit a later auth generation", async () => {
      await reset();
      let release!: () => void; let entered!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const observed = new Promise<void>((resolve) => { entered = resolve; });
      const blocker = withStorageLock(WALLET_SECRET_OPERATION_LOCK_KEY, async () => { entered(); await gate; });
      await observed;
      const creation = createBunkerDraft(id, "Queued");
      transitions.invalidateAuthCeremonies();
      release(); await blocker; await assert.rejects(creation);
      assert.equal(local[BUNKER_DRAFT_VAULT_KEY], undefined);
    });
    await t.test("lock during encryption or reveal prevents commit/plaintext release", async () => {
      await reset();
      let count = 0;
      afterGet = (keys) => { if (keys.includes(BUNKER_DRAFT_VAULT_KEY) && ++count === 2) cache.clearInMemoryAuthCache(); };
      await assert.rejects(createBunkerDraft(id, "Locked"));
      assert.equal(local[BUNKER_DRAFT_VAULT_KEY], undefined);
      afterGet = undefined; cache.setCachedVaultKey(key); cache.setCachedPasswordType("master");
      await createBunkerDraft(id, "Locked");
      afterGet = (keys) => { if (keys.includes(BUNKER_DRAFT_VAULT_KEY)) cache.clearInMemoryAuthCache(); };
      const result = await reveal(id); assert.equal(result.success, false); assert.equal(result.mnemonic, undefined);
    });
    await t.test("master/passkey-style/agent hydration verifies seeds without caching owners", async () => {
      await reset(); await createBunkerDraft(id, "Hydrate");
      const saved = structuredClone(local[BUNKER_DRAFT_VAULT_KEY]);
      for (const role of ["master", "agent"] as const) {
        cache.clearInMemoryAuthCache();
        const result = await auth.hydrateAuthSessionFromVaultKeyBytes(raw, role);
        assert.equal(result.success, true);
        assert.equal(cache.getCachedPassword(), null); assert.equal(cache.getPrivateKeyFromCache(id), null);
      }
      assert.deepEqual(local[BUNKER_DRAFT_VAULT_KEY], saved);
      const bad = structuredClone(saved); bad.entries[0].header.name = "Tampered";
      local[BUNKER_DRAFT_VAULT_KEY] = bad; cache.clearInMemoryAuthCache();
      assert.equal((await auth.hydrateAuthSessionFromVaultKeyBytes(raw, "master")).success, false);
      assert.equal(cache.getPasswordType(), null);
      assert.equal((await validateGeneralVaultMasterRecovery(raw, password)).success, false);
      assert.deepEqual(local[BUNKER_DRAFT_VAULT_KEY], bad);
    });
    await t.test("password rotation and agent-factor lifecycle preserve the draft", async () => {
      await reset(); await createBunkerDraft(id, "Factors");
      const saved = structuredClone(local[BUNKER_DRAFT_VAULT_KEY]);
      assert.equal((await auth.handleSetAgentPassword("bunker-test-agent-password", password)).success, true);
      assert.equal((await auth.handleRemoveAgentPassword(password)).success, true);
      cache.setCachedVaultKey(key); cache.setCachedPasswordType("master");
      assert.equal((await auth.handleChangePassword(password, "bunker-test-new-master-password")).success, true);
      assert.deepEqual(local[BUNKER_DRAFT_VAULT_KEY], saved);
      assert.equal((await auth.handleUnlockWallet("bunker-test-new-master-password")).success, true);
      assert.equal((await reveal(id, "bunker-test-new-master-password")).success, true);
    });
    await t.test("passkey setup, unlock and removal retain Bunker recovery", async () => {
      await reset(); await createBunkerDraft(id, "Passkey");
      const saved = structuredClone(local[BUNKER_DRAFT_VAULT_KEY]);
      const passkey = await import("../../src/chrome/passkeyUnlock");
      const material = {
        credentialId: Buffer.alloc(64, 0x31).toString("base64url"),
        prfSalt: Buffer.alloc(32, 0x32).toString("base64url"),
        prfKeyMaterial: Buffer.alloc(32, 0x33).toString("base64url"),
        authCeremonyEpoch: transitions.getAuthCeremonyEpoch(),
      };
      const setup = await passkey.handleSetupPasskeyUnlockWithPassword(material, password);
      assert.equal(setup.success, true, setup.error);
      cache.clearInMemoryAuthCache();
      const unlocked = await passkey.handleUnlockWithPasskey({ ...material,
        authCeremonyEpoch: transitions.getAuthCeremonyEpoch() });
      assert.equal(unlocked.success, true, unlocked.error);
      assert.equal(cache.getCachedPassword(), null);
      assert.equal((await listBunkerDrafts()).length, 1);
      assert.equal((await reveal(id)).success, true);
      const bad = structuredClone(saved); bad.entries[0].header.name = "Tampered";
      local[BUNKER_DRAFT_VAULT_KEY] = bad;
      assert.equal((await passkey.handleRemovePasskeyUnlock(password)).success, false);
      assert.ok(local.passkeyUnlock);
      local[BUNKER_DRAFT_VAULT_KEY] = saved;
      assert.equal((await passkey.handleRemovePasskeyUnlock(password)).success, true);
      assert.deepEqual(local[BUNKER_DRAFT_VAULT_KEY], saved);
      assert.equal((await auth.handleUnlockWallet(password)).success, true);
      assert.equal((await reveal(id)).success, true);
    });
    await t.test("timed expiry and key replacement revoke captured creation authority", async () => {
      for (const mode of ["expiry", "key"] as const) {
        await reset();
        const originalNow = Date.now;
        let now = Date.now(); Date.now = () => now;
        try {
          cache.setCachedVaultKey(key); cache.setCachedPasswordType("master");
          afterGet = (keys) => {
            if (keys.includes(BUNKER_DRAFT_VAULT_KEY)) {
              if (mode === "expiry") now += 900001;
              else cache.setCachedVaultKey(null);
            }
          };
          await assert.rejects(createBunkerDraft(id, "Revoked"));
          assert.equal(local[BUNKER_DRAFT_VAULT_KEY], undefined);
        } finally { Date.now = originalNow; afterGet = undefined; }
      }
    });
    await t.test("malformed, future, duplicate and colliding drafts are preserved", async () => {
      await reset(); await createBunkerDraft(id, "Codec");
      const saved = structuredClone(local[BUNKER_DRAFT_VAULT_KEY]);
      for (const invalid of [{ version: 99, entries: [] }, null,
        { version: 1, entries: [saved.entries[0], saved.entries[0]] }]) {
        local[BUNKER_DRAFT_VAULT_KEY] = invalid;
        await assert.rejects(listBunkerDrafts());
        await assert.rejects(createBunkerDraft(id, "Codec"));
        assert.deepEqual(local[BUNKER_DRAFT_VAULT_KEY], invalid);
      }
      local[BUNKER_DRAFT_VAULT_KEY] = saved;
      local.seedGroups = [{ id }];
      await assert.rejects(assertBunkerDraftIntegrity(key));
      assert.deepEqual(local[BUNKER_DRAFT_VAULT_KEY], saved);
    });
  } finally {
    if (original) Object.defineProperty(globalThis, "chrome", original);
    else Reflect.deleteProperty(globalThis, "chrome");
  }
});
