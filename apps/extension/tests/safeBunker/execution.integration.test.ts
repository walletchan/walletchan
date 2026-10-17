import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createPublicClient, createWalletClient, http, keccak256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia, baseSepolia } from "viem/chains";
import "fake-indexeddb/auto";

// Disposable Anvil funds only. Uses exact canonical upstream Safe runtimes, not custom contracts.
const payerKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const address = "0x1111111111111111111111111111111111111111" as Hex;
for (const chain of [sepolia, baseSepolia]) test(`standard Safe deployment, external gas and atomic owner rotation on ${chain.id}`, { timeout: 120000 }, async (t) => {
  const chainId = chain.id;
  const port = 19230 + process.pid % 1000 + (chainId === 84532 ? 2000 : 0);
  const rpc = `http://127.0.0.1:${port}`;
  const node = spawn("anvil", ["--port", String(port), "--host", "127.0.0.1", "--chain-id", String(chainId), "--silent"], { stdio: "ignore" });
  const client = createPublicClient({ cacheTime: 0, chain, transport: http(rpc, { retryCount: 0 }) });
  const payer = privateKeyToAccount(payerKey);
  const wallet = createWalletClient({ account: payer, chain, transport: http(rpc) });
  const local: Record<string, any> = {}, sync: Record<string, any> = { autoLockTimeout: 0, networksInfo: { [chainId === 84532 ? "Base Sepolia" : "Ethereum Sepolia"]: { chainId, rpcUrl: rpc } } }, session: Record<string, any> = {};
  const progress: string[] = [];
  const oldChrome = Object.getOwnPropertyDescriptor(globalThis, "chrome");
  const area = (data: Record<string, any>) => ({
    async get(keys: any = null, callback?: (v: any) => void) { const names = keys === null ? Object.keys(data) : typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys); const value = structuredClone(Object.fromEntries(names.map((k: string) => [k, data[k]]))); callback?.(value); return value; },
    async set(values: any) { Object.assign(data, structuredClone(values)); },
    async remove(keys: string | string[]) { for (const key of typeof keys === "string" ? [keys] : keys) delete data[key]; },
    async clear() { for (const key of Object.keys(data)) delete data[key]; },
  });
  Object.defineProperty(globalThis, "chrome", { configurable: true, value: {
    runtime: { getURL: (p: string) => `chrome-extension://test${p}`, sendMessage: async (message: any) => { if (message.type === "safeBunkerExecutionProgress") progress.push(message.phase); }, lastError: undefined },
    storage: { local: area(local), sync: area(sync), session: area(session) },
    notifications: { create: (_id: string, _options: unknown, callback?: (id: string) => void) => { callback?.("test"); return Promise.resolve("test"); } },
    alarms: { create: async () => {}, onAlarm: { addListener() {} } },
  } });
  const mine = async () => { await client.request({ method: "anvil_mine" as any, params: ["0x3"] as any }); };
  try {
    let ready = false;
    for (let i = 0; i < 50; i++) { try { await client.getChainId(); ready = true; break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
    assert.ok(ready, "Anvil started");
    for (const name of ["factory", "singleton", "multiSend"]) {
      const fixture = JSON.parse(await readFile(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
      assert.equal(keccak256(fixture.runtime), fixture.codeHash);
      await client.request({ method: "anvil_setCode" as any, params: [fixture.address, fixture.runtime] as any });
    }
    const crypto = await import("../../src/chrome/crypto");
    const vault = await import("../../src/chrome/vaultCrypto");
    const cache = await import("../../src/chrome/sessionCache");
    const { createBunkerDraft } = await import("../../src/chrome/safeBunker/drafts");
    const { prepareBunkerDeployment, estimateBunkerDeployment, deployBunker, verifyBunkerDeployment } = await import("../../src/chrome/safeBunker/deployment");
    const { readBunkerState } = await import("../../src/chrome/safeBunker/stateRepository");
    const { queueBunkerOperation, reviewBunkerOperation, confirmBunkerOperation, stateForAccount } = await import("../../src/chrome/safeBunker/operations");
    const { reconcileBunker } = await import("../../src/chrome/safeBunker/reconciliation");
    const { deriveBunkerOwner, withBunkerOwnerKey } = await import("../../src/chrome/safeBunker/derivation");
    const { withBunkerDraftSeed } = await import("../../src/chrome/safeBunker/crypto");
    const { bunkerEntry, readBunkerLive } = await import("../../src/chrome/safeBunker/live");
    const { bunkerExecutionData, buildBunkerTransaction: buildOnChain } = await import("../../src/chrome/safeBunker/transaction");
    const { captureBunkerAccess } = await import("../../src/chrome/safeBunker/access");
    const { continueBunkerRecovery, createBunkerRecoveryOperation } = await import("../../src/chrome/safeBunker/recovery");
    const buildBunkerTransaction = (safe: Hex, nonce: bigint, owner: Hex, next: Hex, calls: any[], recovery = false) => buildOnChain(safe, nonce, owner, next, calls, recovery, chainId);
    const raw = crypto.generateVaultKey(), key = await crypto.importVaultKey(raw);
    const password = "synthetic-bunker-master-password";
    local.encryptedVaultKeyMaster = await crypto.encryptVaultKey(raw, password);
    local.accounts = [{ id: "payer", type: "privateKey", address: payer.address.toLowerCase(), createdAt: 1 }];
    local.pkVault = { version: 1, entries: [{ id: "payer", keystore: await vault.encryptPrivateKeyWithVaultKey(payerKey, key) }] };
    const unlock = (role: "master" | "agent" = "master") => { cache.setCachedVaultKey(key); cache.setCachedPasswordDirect(role === "master" ? password : null); cache.setCachedVault([{ id: "payer", privateKey: payerKey }]); cache.setCachedPasswordType(role); };
    unlock();
    cache.setCachedPasswordDirect(password);
    const { saveSeedPhraseOnly } = await import("../../src/chrome/mnemonic/savePhraseOnly");
    const sourceGroup = await saveSeedPhraseOnly({ generate: false, mnemonic: `${"abandon ".repeat(11)}about` });
    const id = (await createBunkerDraft(sourceGroup.id, chainId)).id;
    let state = await prepareBunkerDeployment(id, client);
    assert.equal(local.accounts.some((a: any) => a.type === "safeBunker"), false, "preparation never adds an account");
    const predicted = state.plan.address;
    const estimate = await estimateBunkerDeployment(state, "payer", client);
    await deployBunker(id, "payer", estimate.gas, true, client);
    state = (await readBunkerState(id))!;
    assert.equal(local.accounts.find((a: any) => a.id === state.accountId)?.deploymentPending, true, "broadcast publishes a pending account");
    const { assertBunkerDraftIntegrity } = await import("../../src/chrome/safeBunker/integrity");
    await assertBunkerDraftIntegrity(key);
    const pendingAccount = local.accounts.find((a: any) => a.id === state.accountId);
    delete pendingAccount.deploymentPending;
    await assert.rejects(assertBunkerDraftIntegrity(key), /binding/);
    pendingAccount.deploymentPending = true;
    const { readSignedBunkerDeployment } = await import("../../src/chrome/safeBunker/deploymentPublication");
    await assert.rejects(readSignedBunkerDeployment({ ...state, plan: { ...state.plan, raw: "0x02" } }), /identity/);
    const sessionAuth = await import("../../src/chrome/authHandlers");
    for (const role of ["master", "agent"] as const) {
      assert.equal((await sessionAuth.hydrateAuthSessionFromVaultKeyBytes(raw, role)).success, true);
    }
    unlock();
    await assert.rejects(stateForAccount(state.accountId), /identity/);
    const { getTxHistory: getAllTxHistory } = await import("../../src/chrome/txHistoryStorage");
    const getTxHistory = async () => (await getAllTxHistory()).filter(row => row.chainId === chainId);
    const deploymentRows = (await getTxHistory()).filter(row => row.safeDeploymentMeta);
    assert.equal(deploymentRows.length, 2);
    assert.deepEqual(new Set(deploymentRows.map(row => row.tx.from.toLowerCase())), new Set([predicted, payer.address.toLowerCase()]));
    assert.ok(deploymentRows.every(row => row.status === "pending" && row.txHash === state.plan.deploymentHash));
    assert.ok(deploymentRows.every(row => !row.tx.data));
    const { ensureBunkerDeploymentHistory } = await import("../../src/chrome/safeBunker/deploymentPublication");
    await ensureBunkerDeploymentHistory((await readBunkerState(id))!);
    assert.equal((await getTxHistory()).filter(row => row.safeDeploymentMeta).length, 2, "deployment history repair is idempotent");
    state = (await readBunkerState(id))!;
    assert.equal(await verifyBunkerDeployment(state, client, captureBunkerAccess()), false, "wait for deployment confirmations");
    assert.equal(local.accounts.find((a: any) => a.id === state.accountId)?.deploymentPending, true, "unconfirmed deployment cannot execute");
    await mine(); state = (await readBunkerState(id))!;
    assert.equal(await verifyBunkerDeployment(state, client, captureBunkerAccess()), true);
    state = (await readBunkerState(id))!;
    assert.equal(state.plan.address, predicted); assert.ok(state.activated);
    assert.equal(local.accounts.length, 2); assert.equal(state.defaultPayer?.id, "payer");
    assert.equal(local.accounts.find((a: any) => a.id === state.accountId)?.deploymentPending, undefined);
    await assertBunkerDraftIntegrity(key);
    const { applyReceiptToHistory } = await import("../../src/chrome/forceInclusion/receiptPoller");
    const deploymentReceipt = await client.getTransactionReceipt({ hash: state.plan.deploymentHash! });
    for (const row of deploymentRows) await applyReceiptToHistory(row.id, row.txHash!, chainId, deploymentReceipt);
    assert.ok((await getTxHistory()).filter(row => row.safeDeploymentMeta).every(row => row.status === "success"));
    const seed = await withBunkerDraftSeed(await bunkerEntry(id), key, (phrase) => phrase);
    const owner0 = deriveBunkerOwner(seed, chainId, 0);
    assert.equal(await client.getBalance({ address: owner0 }), 0n);
    assert.equal(await client.getTransactionCount({ address: owner0 }), 0);
    await wallet.sendTransaction({ to: predicted, value: 100000000000000000n });
    const amount = 1000000000000000n;
    const create = async (n: number) => {
      const operationId = `test-op-${n}`;
      await queueBunkerOperation({ id: operationId, accountId: state.accountId, chainId: chainId,
        calls: [{ to: address, value: amount.toString() as `${bigint}`, data: "0x", operation: 0 }], routes: [{ kind: "wallet", origin: "WalletChan", requestId: operationId }] });
      return operationId;
    };
    await t.test("local payer pays gas; the Safe rotates atomically", async () => {
      const operationId = await create(1);
      const { getPendingBunkerRequests } = await import("../../src/chrome/safeBunker/pendingRequests");
      const { synchronizeBunkerPendingIndex } = await import("../../src/chrome/safeBunker/view");
      assert.equal((await getPendingBunkerRequests()).length, 1);
      delete local.safeBunkerPendingV1; // Upgrade from journals predating the notification index.
      const journalBefore = JSON.stringify(local.safeBunkerJournalsV2);
      await synchronizeBunkerPendingIndex();
      const migrated = JSON.stringify(local.safeBunkerPendingV1);
      assert.equal((await getPendingBunkerRequests())[0].id, operationId);
      await synchronizeBunkerPendingIndex();
      assert.equal(JSON.stringify(local.safeBunkerPendingV1), migrated, "index repair is idempotent");
      assert.equal(JSON.stringify(local.safeBunkerJournalsV2), journalBefore, "repair never rewrites encrypted journal");
      const reviewed = await reviewBunkerOperation(state.accountId, operationId, "payer", client);
      const payerBefore = await client.getBalance({ address: payer.address });
      const reads: { method: string; args: any }[] = [];
      const watched = new Proxy(client, { get(target, property) {
        const value = Reflect.get(target, property);
        if (typeof value !== "function") return value;
        return (...args: any[]) => {
          reads.push({ method: String(property), args: args[0] });
          if (property === "call") {
            assert.ok(local.safeBunkerJournalsV2, "signature-bearing simulation follows durable journal commit");
            assert.equal(args[0].gas, BigInt(reviewed.review!.gas.gasLimit));
            assert.equal(typeof args[0].blockNumber, "bigint");
          }
          return value(...args);
        };
      } });
      progress.length = 0;
      const rpcMethods: string[] = [], nativeFetch = globalThis.fetch;
      globalThis.fetch = (async (url, init) => {
        if (typeof init?.body === "string") rpcMethods.push(JSON.parse(init.body).method);
        return nativeFetch(url, init);
      }) as typeof fetch;
      try { await confirmBunkerOperation(state.accountId, operationId, reviewed.review!.digest, true, watched); }
      finally { globalThis.fetch = nativeFetch; }
      assert.equal(rpcMethods.includes("eth_fillTransaction"), false, "payer preparation never delegates reviewed gas fields to RPC");
      assert.equal(rpcMethods.filter(m => m === "eth_estimateGas").length, 0);
      assert.equal(rpcMethods.filter(m => m === "eth_call").length, 6, "five Safe state reads plus one signed execution simulation");
      assert.equal(reads.filter(r => r.method === "call").length, 1, "one exact simulation");
      assert.equal(reads.filter(r => r.method === "estimateGas").length, 0, "gas is prepared during review");
      assert.equal(reads.filter(r => r.method === "getBlock").length, 0, "no historical block reads");
      assert.equal(reads.filter(r => r.method === "getBlockNumber").length, 1, "one fresh pinned preflight");
      assert.equal(reads.filter(r => r.method === "getCode").length, 2, "only mutable owner/successor code, no deployment reverification");
      assert.deepEqual(progress, ["signing", "checking", "broadcasting", "submitted"]);
      assert.ok((await readBunkerState(id))!.operations[0].signature);
      await mine(); await reconcileBunker(id, client); state = await stateForAccount(state.accountId);
      assert.deepEqual(await getPendingBunkerRequests(), [], "confirmed operation leaves no pending notification");
      assert.equal(state.ownerIndex, 1); assert.equal(state.operations[0].state, "confirmed");
      const { getTxById } = await import("../../src/chrome/txHistoryStorage");
      const bunkerRow = await getTxById(`bunker:${state.accountId}:${operationId}`);
      assert.deepEqual(bunkerRow?.safeBunkerMeta?.calls, state.operations[0].calls);
      const payerRows = (await getTxHistory()).filter((row) => row.id.startsWith("bunker-executor:"));
      assert.equal(payerRows.length, 1);
      assert.equal(payerRows[0].tx.from, payer.address.toLowerCase());
      assert.equal(payerRows[0].tx.to, predicted);
      assert.equal(payerRows[0].safeExecutionMeta?.nonce, 0);
      assert.equal(payerRows[0].txHash, bunkerRow?.txHash);
      const { ensureBunkerHistory } = await import("../../src/chrome/safeBunker/history");
      const { updateTxInHistory } = await import("../../src/chrome/txHistoryStorage");
      await updateTxInHistory(bunkerRow!.id, { safeBunkerMeta: undefined, functionName: "Bunker execution" });
      await ensureBunkerHistory(state, state.operations[0]);
      await ensureBunkerHistory(state, state.operations[0]);
      assert.deepEqual((await getTxById(bunkerRow!.id))?.safeBunkerMeta?.calls, state.operations[0].calls);
      assert.equal((await getTxHistory()).filter((row) => row.id.startsWith("bunker-executor:")).length, 1, "restart repair is idempotent");
      assert.ok(await client.getBalance({ address: payer.address }) < payerBefore);
      assert.equal(await client.getBalance({ address: owner0 }), 0n);
      assert.equal(await client.getTransactionCount({ address: owner0 }), 0);
      assert.equal(await client.getBalance({ address }), amount);
    });
    await t.test("a nonrotating external Safe transaction advances nonce, not derivation index", async () => {
      const live = await readBunkerLive(state, client);
      const { buildSafeTransaction } = await import("../../src/chrome/safe/transactionBuilder");
      const external = buildSafeTransaction({ chainId: chainId, safeAddress: predicted, safeVersion: "1.4.1", nonce: BigInt(live.nonce), calls: [{ to: address, value: "0", data: "0x", operation: 0 }] });
      const signature = await withBunkerOwnerKey(seed, chainId, 1, (k) => privateKeyToAccount(k).sign({ hash: external.safeTxHash }));
      await wallet.sendTransaction({ to: predicted, data: bunkerExecutionData(external.transaction, signature) });
      const operationId = await create(2);
      unlock("agent");
      await assert.rejects(reviewBunkerOperation(state.accountId, operationId, "payer", client), /Authentication changed/);
      await assert.rejects(confirmBunkerOperation(state.accountId, operationId, "0x00", false, client), /Authentication changed/);
      unlock();
      const reviewed = await reviewBunkerOperation(state.accountId, operationId, "payer", client);
      assert.equal(reviewed.review!.ownerIndex, 1); assert.equal(reviewed.review!.nonce, 2);
      await confirmBunkerOperation(state.accountId, operationId, reviewed.review!.digest, false, client);
      await mine();
      const afterRotation = await readBunkerLive(state, client);
      const later = buildSafeTransaction({ chainId: chainId, safeAddress: predicted, safeVersion: "1.4.1", nonce: BigInt(afterRotation.nonce), calls: [{ to: address, value: "0", data: "0x", operation: 0 }] });
      const laterSignature = await withBunkerOwnerKey(seed, chainId, 2, (k) => privateKeyToAccount(k).sign({ hash: later.safeTxHash }));
      await wallet.sendTransaction({ to: predicted, data: bunkerExecutionData(later.transaction, laterSignature) });
      await reconcileBunker(id, client); state = await stateForAccount(state.accountId);
      assert.equal(state.ownerIndex, 2); assert.equal(state.operations[0].state, "confirmed"); unlock();
    });
    await t.test("a reverted user CALL rolls back transfers and rotation", async () => {
      const bad = "0x2222222222222222222222222222222222222222" as Hex;
      await client.request({ method: "anvil_setCode" as any, params: [bad, "0x60006000fd"] as any });
      const live = await readBunkerLive(state, client);
      const built = buildBunkerTransaction(predicted, BigInt(live.nonce), deriveBunkerOwner(seed, chainId, 2), deriveBunkerOwner(seed, chainId, 3), [
        { to: address, value: "1", data: "0x", operation: 0 }, { to: bad, value: "0", data: "0x", operation: 0 },
      ]);
      const signature = await withBunkerOwnerKey(seed, chainId, 2, (k) => privateKeyToAccount(k).sign({ hash: built.safeTxHash }));
      const before = await client.getBalance({ address });
      const hash = await wallet.sendTransaction({ to: predicted, data: bunkerExecutionData(built.transaction, signature), gas: 1000000n });
      const receipt = await client.waitForTransactionReceipt({ hash }); assert.equal(receipt.status, "reverted");
      assert.equal(await client.getBalance({ address }), before);
      const after = await readBunkerLive(state, client); assert.equal(after.nonce, live.nonce); assert.deepEqual(after.owners, live.owners);
    });
    await t.test("unsigned grouping uses one rotation and a real seed-phrase payer", async () => {
      const { addSeedPhraseGroup } = await import("../../src/chrome/mnemonic/accountHandlers");
      cache.setCachedPasswordDirect(password);
      const imported = await addSeedPhraseGroup({ mnemonic: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about", indices: [0], name: "Synthetic payer" });
      assert.ok(imported.success, imported.success ? "" : imported.error);
      if (!imported.success) return;
      await wallet.sendTransaction({ to: imported.account.address as Hex, value: 100000000000000000n });
      const { groupBunkerOperations } = await import("../../src/chrome/safeBunker/management");
      const first = await create(3), second = await create(4);
      await groupBunkerOperations(state.accountId, [first, second]);
      state = await stateForAccount(state.accountId);
      const grouped = state.operations.find((o) => o.members)!;
      assert.equal(grouped.calls.length, 2);
      const reviewed = await reviewBunkerOperation(state.accountId, grouped.id, imported.account.id, client);
      await confirmBunkerOperation(state.accountId, grouped.id, reviewed.review!.digest, true, client);
      await assert.rejects(confirmBunkerOperation(state.accountId, grouped.id, reviewed.review!.digest, true, client));
      await mine(); await reconcileBunker(id, client); state = await stateForAccount(state.accountId);
      assert.equal(state.ownerIndex, 3); assert.equal(state.defaultPayer?.id, imported.account.id);
      // Read a new request through the same persisted projection used by the UI.
      const nextRequest = await create(79);
      const { projectBunkerView } = await import("../../src/chrome/safeBunker/view");
      const nextView = await projectBunkerView((await readBunkerState(id))!);
      assert.equal(nextView.defaultPayer?.id, imported.account.id);
      assert.equal(nextView.defaultPayer?.address, imported.account.address.toLowerCase());
      assert.equal(nextView.operations.find(op => op.id === nextRequest)?.payerId, undefined);
      const { rejectBunkerOperation } = await import("../../src/chrome/safeBunker/operations");
      await rejectBunkerOperation(state.accountId, nextRequest);
    });
    await t.test("reject commits while gas review is stalled and late review cannot resurrect it", async () => {
      const { rejectBunkerOperation } = await import("../../src/chrome/safeBunker/operations");
      const operationId = await create(80);
      let release!: () => void, entered!: () => void;
      const started = new Promise<void>(resolve => { entered = resolve; });
      const held = new Promise<void>(resolve => { release = resolve; });
      const slow = { ...client, estimateGas: async (args: any) => { entered(); await held; return client.estimateGas(args); } };
      const review = assert.rejects(reviewBunkerOperation(state.accountId, operationId, "payer", slow as typeof client), /Bunker review changed/);
      await started;
      try {
        await Promise.race([rejectBunkerOperation(state.accountId, operationId), new Promise((_, reject) => setTimeout(() => reject(Error("Reject waited for RPC")), 2000))]);
        assert.equal((await stateForAccount(state.accountId)).operations.find(o => o.id === operationId)!.state, "rejected");
      } finally { release(); }
      await review;
      assert.equal((await stateForAccount(state.accountId)).operations.find(o => o.id === operationId)!.state, "rejected");
    });
    await t.test("newer fee review wins and rejection delivery retries from its durable state", async () => {
      const { rejectBunkerOperation } = await import("../../src/chrome/safeBunker/operations");
      const { writeBunkerState } = await import("../../src/chrome/safeBunker/stateRepository");
      const { flushBunkerRejections } = await import("../../src/chrome/safeBunker/publication");
      const operationId = await create(81);
      let release!: () => void, entered!: () => void;
      const started = new Promise<void>(resolve => { entered = resolve; });
      const held = new Promise<void>(resolve => { release = resolve; });
      const slow = { ...client, estimateGas: async (args: any) => { entered(); await held; return client.estimateGas(args); } };
      const stale = assert.rejects(reviewBunkerOperation(state.accountId, operationId, "payer", slow as typeof client), /Bunker review changed/);
      await started;
      const latest = await reviewBunkerOperation(state.accountId, operationId, "payer", client);
      release(); await stale;
      const pending = await stateForAccount(state.accountId);
      assert.equal(pending.operations.find(o => o.id === operationId)!.review!.digest, latest.review!.digest);
      pending.operations.find(o => o.id === operationId)!.routes = [{ kind: "injected", origin: "https://fixture.example", tabId: 1, requestId: operationId }];
      await writeBunkerState(pending, captureBunkerAccess());
      const setter = chrome.storage.local.set;
      let acknowledged = 0;
      chrome.storage.local.set = (async (values: any) => {
        if (values[`txResult:${operationId}`]) throw Error("Synthetic result delivery failure");
        return setter(values);
      }) as typeof setter;
      try { await assert.rejects(rejectBunkerOperation(state.accountId, operationId, () => { acknowledged++; }), /Synthetic result delivery/); }
      finally { chrome.storage.local.set = setter; }
      assert.equal(acknowledged, 1, "UI success follows durable reject, before delivery");
      assert.equal((await stateForAccount(state.accountId)).operations.find(o => o.id === operationId)!.state, "rejected");
      await flushBunkerRejections(id, captureBunkerAccess());
      assert.equal(local[`txResult:${operationId}`].result.code, 4001);
      assert.equal((await stateForAccount(state.accountId)).operations.find(o => o.id === operationId)!.resultPublished, true);
    });
    await t.test("unpublished rejection results survive journal compaction", async () => {
      const { writeBunkerState } = await import("../../src/chrome/safeBunker/stateRepository");
      const original = await stateForAccount(state.accountId);
      const snapshot = structuredClone(original);
      snapshot.operations = Array.from({ length: 90 }, (_, n) => ({ id: `unpublished-${n}`, kind: "transaction" as const,
        state: "rejected" as const, createdAt: 1, calls: [{ to: address, value: "0", data: "0x", operation: 0 }],
        routes: [{ kind: "wallet" as const, origin: "WalletChan", requestId: `unpublished-${n}` }] }));
      await writeBunkerState(snapshot, captureBunkerAccess());
      try {
        await create(82);
        const compacted = await stateForAccount(state.accountId);
        assert.equal(compacted.operations.filter(o => o.state === "rejected" && !o.resultPublished).length, 90);
      } finally { await writeBunkerState(original, captureBunkerAccess()); }
    });
    await t.test("failed exact simulation preserves exposure and reuses the signed intent", async () => {
      const opId = await create(5);
      let reviewed = await reviewBunkerOperation(state.accountId, opId, "payer", client);
      const unavailable = { ...client, call: async () => { throw new Error("Synthetic exact simulation unavailable"); } } as typeof client;
      await assert.rejects(confirmBunkerOperation(state.accountId, opId, reviewed.review!.digest, false, unavailable));
      state = await stateForAccount(state.accountId);
      const signature = state.operations.find((o) => o.id === opId)!.signature;
      assert.ok(signature); assert.equal(state.ownerIndex, 3);
      const { assertBunkerResetSafe } = await import("../../src/chrome/safeBunker/management");
      await assert.rejects(assertBunkerResetSafe());
      reviewed = await reviewBunkerOperation(state.accountId, opId, "payer", client);
      await confirmBunkerOperation(state.accountId, opId, reviewed.review!.digest, false, client);
      assert.equal((await stateForAccount(state.accountId)).operations.find((o) => o.id === opId)!.signature, signature);
      await mine(); await reconcileBunker(id, client); state = await stateForAccount(state.accountId);
      assert.equal(state.ownerIndex, 4);
    });
    await t.test("master recovery skips exposed successors and invalidates the losing intent", async () => {
      const opId = await create(6);
      const reviewed = await reviewBunkerOperation(state.accountId, opId, "payer", client);
      const unavailable = { ...client, call: async () => { throw new Error("Synthetic exact simulation unavailable"); } } as typeof client;
      await assert.rejects(confirmBunkerOperation(state.accountId, opId, reviewed.review!.digest, false, unavailable));
      const recovery = await createBunkerRecoveryOperation(state.accountId, client);
      assert.ok("id" in recovery); if (!("id" in recovery)) return;
      const replacement = await reviewBunkerOperation(state.accountId, recovery.id, "payer", client);
      assert.ok(replacement.review!.nextIndex > reviewed.review!.nextIndex);
      await confirmBunkerOperation(state.accountId, recovery.id, replacement.review!.digest, false, client);
      await mine(); await reconcileBunker(id, client); state = await stateForAccount(state.accountId);
      assert.equal(state.operations.find((o) => o.id === opId)!.state, "invalidated");
      assert.equal(state.ownerIndex, 6);
    });
    await t.test("external execution is discovered by Safe hash and a reorg blocks further spending", async () => {
      const snapshot = await client.request({ method: "evm_snapshot" as any });
      const opId = await create(7);
      const reviewed = await reviewBunkerOperation(state.accountId, opId, "payer", client);
      const unavailable = { ...client, call: async () => { throw new Error("Synthetic worker stopped after signature commit"); } } as typeof client;
      await assert.rejects(confirmBunkerOperation(state.accountId, opId, reviewed.review!.digest, false, unavailable));
      state = await stateForAccount(state.accountId);
      const exposed = state.operations.find((o) => o.id === opId)!;
      assert.equal(exposed.outer, undefined);
      await wallet.sendTransaction({ to: predicted, data: bunkerExecutionData(exposed.review!.transaction, exposed.signature!) });
      await mine(); await reconcileBunker(id, client); state = await stateForAccount(state.accountId);
      assert.equal(state.ownerIndex, 7); assert.equal(state.operations.find((o) => o.id === opId)!.state, "confirmed");
      await client.request({ method: "evm_revert" as any, params: [snapshot] as any });
      await mine(); await reconcileBunker(id, client); state = await stateForAccount(state.accountId);
      assert.ok(state.exposureUnknown);
      await createBunkerRecoveryOperation(state.accountId, client);
      await continueBunkerRecovery(id, client);
      const recovery = await createBunkerRecoveryOperation(state.accountId, client);
      assert.ok("id" in recovery); if (!("id" in recovery)) return;
      const replacement = await reviewBunkerOperation(state.accountId, recovery.id, "payer", client);
      assert.ok(replacement.review!.nextIndex > 7);
      await confirmBunkerOperation(state.accountId, recovery.id, replacement.review!.digest, false, client);
      await mine(); await reconcileBunker(id, client); state = await stateForAccount(state.accountId);
      assert.equal(state.ownerIndex, 8); assert.equal(state.exposureUnknown, false);
    });
    await t.test("current-owner recovery uses local derivation, keeps known exposure and repins a moving owner without logs", async () => {
      const { writeBunkerState } = await import("../../src/chrome/safeBunker/stateRepository");
      const rotateExternally = async (oldIndex: number, nextIndex: number) => {
        const live = await readBunkerLive(state, client);
        const built = buildBunkerTransaction(predicted, BigInt(live.nonce), deriveBunkerOwner(seed, chainId, oldIndex), deriveBunkerOwner(seed, chainId, nextIndex), [], true);
        const signature = await withBunkerOwnerKey(seed, chainId, oldIndex, (key) => privateKeyToAccount(key).sign({ hash: built.safeTxHash }));
        await wallet.sendTransaction({ to: predicted, data: bunkerExecutionData(built.transaction, signature), gas: 1000000n }); await mine();
      };
      state.nextIndex = 150;
      const reservedOwner = deriveBunkerOwner(seed, chainId, 149);
      state.usedOwners.push(reservedOwner);
      await writeBunkerState(state, captureBunkerAccess());
      await rotateExternally(state.ownerIndex, 130);
      let logReads = 0;
      const noLogs = { ...client, getLogs: async () => { logReads++; throw new Error("eth_getLogs is unavailable"); } } as typeof client;
      assert.deepEqual(await createBunkerRecoveryOperation(state.accountId, noLogs), { scanning: true });
      const ownerReadOnly = { ...noLogs,
        getCode: async () => { throw new Error("No repeated infrastructure reads during local search"); },
        getBlockNumber: async () => { throw new Error("No historical scan head reads during local search"); },
        readContract: async (args: any) => { assert.equal(args.functionName, "getOwners"); return client.readContract(args); },
      } as typeof client;
      await continueBunkerRecovery(id, ownerReadOnly);
      let scan = (await readBunkerState(id))!;
      assert.equal(scan.recovery?.deriveIndex, 64);
      assert.equal(scan.recovery?.targetOwner, deriveBunkerOwner(seed, chainId, 130));
      await continueBunkerRecovery(id, ownerReadOnly);
      scan = (await readBunkerState(id))!;
      assert.equal(scan.recovery?.deriveIndex, 128);
      let moved = false;
      const movingOwner = { ...noLogs, readContract: async (args: any) => {
        const result = await client.readContract(args);
        if (!moved && args.functionName === "getOwners") { moved = true; await rotateExternally(130, 12); }
        return result;
      } } as typeof client;
      await continueBunkerRecovery(id, movingOwner);
      scan = (await readBunkerState(id))!;
      assert.ok(scan.recovery, "activation rechecks the current owner after deriving");
      assert.equal(scan.recovery.targetOwner, undefined);
      await continueBunkerRecovery(id, noLogs);
      state = await stateForAccount(state.accountId);
      assert.equal(state.recovery, null); assert.equal(state.ownerIndex, 12);
      assert.equal(state.nextIndex, 150); assert.ok(state.usedOwners.includes(reservedOwner));
      assert.ok(state.exposureUnknown); assert.equal(logReads, 0);
    });
    await t.test("Add existing revalidates the source without logs or forcing a recovery rotation", async () => {
      const { discoverBunker, addExistingBunker } = await import("../../src/chrome/safeBunker/discovery");
      const { writeBunkerState } = await import("../../src/chrome/safeBunker/stateRepository");
      // Explicitly settle the recovery required by the external-owner-change scenario above.
      const recoveryOp = await createBunkerRecoveryOperation(state.accountId, client);
      const operationId = "id" in recoveryOp ? recoveryOp.id : "";
      const review = await reviewBunkerOperation(state.accountId, operationId, "payer", client);
      await confirmBunkerOperation(state.accountId, operationId, review.review!.digest, false, client);
      await mine(); await reconcileBunker(id, client); state = await stateForAccount(state.accountId);
      const index = state.ownerIndex, recoveryCount = state.operations.filter(o => o.kind === "recovery").length;
      local.accounts = local.accounts.filter((a: any) => a.type !== "safeBunker");
      state.archived = true; await writeBunkerState(state, captureBunkerAccess());
      const withoutLogs = { ...client, getLogs: async () => { throw new Error("Discovery must not request event history"); } } as typeof client;
      unlock("agent"); await assert.rejects(discoverBunker(sourceGroup.id, chainId, withoutLogs), /Authentication changed/);
      unlock();
      const result = await discoverBunker(sourceGroup.id, chainId, withoutLogs);
      assert.equal(result.status, "deployed");
      assert.equal(await addExistingBunker(sourceGroup.id, chainId, withoutLogs), state.accountId);
      state = await stateForAccount(state.accountId);
      assert.equal(state.ownerIndex, index); assert.equal(state.exposureUnknown, false);
      assert.equal(state.operations.filter(o => o.kind === "recovery").length, recoveryCount, "restore adds no recovery transaction");
    });
    await t.test("master removal clears operational data and repairs selection", async () => {
      const { removeBunkerAccount } = await import("../../src/chrome/safeBunker/management");
      const restoredId = id;
      const restored = (await readBunkerState(restoredId))!;
      unlock("agent");
      await assert.rejects(removeBunkerAccount(restored.accountId, true), /Authentication changed/);
      unlock(); cache.setCachedPasswordType(null);
      await assert.rejects(removeBunkerAccount(restored.accountId, true), /Authentication changed/);
      unlock(); cache.setCachedPasswordDirect(null);
      await assert.rejects(removeBunkerAccount(restored.accountId, false), /Confirm seed backup/);
      assert.ok(local.accounts.some((a: any) => a.id === restored.accountId));
      sync.activeAccountId = restored.accountId;
      const syncApi = chrome.storage.sync as any, originalSet = syncApi.set;
      syncApi.set = async () => { throw new Error("This request exceeds the MAX_WRITE_OPERATIONS_PER_MINUTE quota."); };
      try {
        await assert.rejects(removeBunkerAccount(restored.accountId, true), /Browser sync is busy/);
        assert.ok(local.accounts.some((a: any) => a.id === restored.accountId), "sync failure preserves the account");
        assert.equal((await readBunkerState(restoredId))!.archived, false);
      } finally { syncApi.set = originalSet; }
      const beforeRemoval = structuredClone(local);
      const localApi = chrome.storage.local as any, originalLocalSet = localApi.set;
      localApi.set = async (values: any) => {
        if (values.seedGroups) throw new Error("synthetic local write failure");
        return originalLocalSet(values);
      };
      try {
        await assert.rejects(removeBunkerAccount(restored.accountId, true), /synthetic local write failure/);
        assert.deepEqual(local, beforeRemoval, "failed cleanup preserves accounts, phrase, bindings and journals");
      } finally { localApi.set = originalLocalSet; }
      const historyIds = (await getTxHistory()).map(row => row.id).sort();
      await removeBunkerAccount(restored.accountId, true);
      assert.deepEqual((await getTxHistory()).map(row => row.id).sort(), historyIds, "Activity survives account removal");
      assert.ok(!local.accounts.some((a: any) => a.id === restored.accountId));
      assert.equal(await readBunkerState(restoredId), null);
      assert.ok(!local.safeBunkerBindingsV2.entries.some((e: any) => e.header.id === restoredId));
      assert.ok(!local.seedGroups.some((g: any) => g.id === sourceGroup.id));
      assert.ok(!local.mnemonicVault.entries.some((e: any) => e.id === sourceGroup.id));
      const { assertBunkerDraftIntegrity } = await import("../../src/chrome/safeBunker/integrity");
      await assertBunkerDraftIntegrity(key);
      assert.notEqual(sync.activeAccountId, restored.accountId);
    });
  } finally {
    // Let normal executor receipt/enrichment work settle before removing Chrome and Anvil.
    await new Promise((resolve) => setTimeout(resolve, 6000));
    node.kill("SIGTERM");
    if (oldChrome) Object.defineProperty(globalThis, "chrome", oldChrome); else Reflect.deleteProperty(globalThis, "chrome");
  }
});
