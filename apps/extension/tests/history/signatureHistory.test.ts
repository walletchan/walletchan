import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IDBFactory, IDBKeyRange, IDBObjectStore } from "fake-indexeddb";
import { createServer } from "vite";
import { hashMessage } from "viem";
import { createChromeStorageHarness } from "../helpers/chromeStorageHarness";

const address = `0x${"1".repeat(40)}`;
const other = `0x${"2".repeat(40)}`;

test("signed history encrypts, filters, deduplicates, bounds, exports and resets without clearing transactions", async () => {
  const originalIdb = globalThis.indexedDB;
  const originalRange = globalThis.IDBKeyRange;
  Object.assign(globalThis, { indexedDB: new IDBFactory(), IDBKeyRange });
  // A real v2 database must upgrade without changing either existing store.
  const oldDatabase = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("walletchan-history", 2);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("transactions", { keyPath: "id" });
      request.result.createObjectStore("assetTransfers", { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = oldDatabase.transaction(
      ["transactions", "assetTransfers"],
      "readwrite",
    );
    tx.objectStore("transactions").put({ id: "upgrade", marker: "preserved" });
    tx.objectStore("assetTransfers").put({
      key: "upgrade-transfer",
      marker: "preserved",
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  oldDatabase.close();
  const harness = createChromeStorageHarness({
    sync: { autoLockTimeout: 60_000 },
  });
  const extensionRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  const server = await createServer({
    root: extensionRoot,
    configFile: false,
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true },
    resolve: { alias: { "@": path.join(extensionRoot, "src") } },
  });
  try {
    const session = await server.ssrLoadModule("/src/chrome/sessionCache.ts");
    const repository = await server.ssrLoadModule(
      "/src/chrome/signatureHistory/repository.ts",
    );
    const database = await server.ssrLoadModule(
      "/src/chrome/signatureHistory/database.ts",
    );
    const history = await server.ssrLoadModule(
      "/src/chrome/history/database.ts",
    );
    const upgraded = await history.openHistoryDatabase();
    assert.equal(upgraded.version, 4);
    await new Promise<void>((resolve, reject) => {
      const tx = upgraded.transaction(
        ["transactions", "assetTransfers"],
        "readwrite",
      );
      const row = tx.objectStore("transactions").get("upgrade");
      row.onsuccess = () => assert.equal(row.result.marker, "preserved");
      const transfer = tx.objectStore("assetTransfers").get("upgrade-transfer");
      transfer.onsuccess = () =>
        assert.equal(transfer.result.marker, "preserved");
      tx.objectStore("transactions").delete("upgrade");
      tx.objectStore("assetTransfers").delete("upgrade-transfer");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    const model = await server.ssrLoadModule(
      "/src/chrome/signatureHistory/model.ts",
    );
    const exporter = await server.ssrLoadModule(
      "/src/chrome/signatureHistory/export.ts",
    );
    const auth = await server.ssrLoadModule("/src/chrome/authTransition.ts");
    const key = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    session.setCachedVaultKey(key);
    session.setCachedPasswordType("agent");
    const account = { id: "owner", type: "privateKey", address, createdAt: 1 };
    const entry = model.pendingSignatureHistoryEntry(
      {
        id: "one",
        signature: {
          method: "personal_sign",
          params: ["0x68656c6c6f", address],
          chainId: 1,
        },
        senderOrigin: "https://app.example",
        origin: "https://spoof.example",
      },
      account,
    );
    assert.equal(entry.digest, hashMessage({ raw: "0x68656c6c6f" }));
    assert.equal(entry.origin, "https://app.example");
    const stored = await repository.prepareSignatureHistory(entry);
    assert.equal(JSON.stringify(stored).includes("app.example"), false);
    assert.equal(JSON.stringify(stored).includes("0x68656c6c6f"), false);
    await repository.commitSignatureHistory(stored);
    await repository.commitSignatureHistory(stored);
    assert.equal((await database.readStoredSignatures()).length, 1);
    assert.deepEqual(
      (await repository.getSignatureHistory()).entries[0],
      entry,
    );
    assert.equal(
      (await repository.getSignatureHistory({ ownerAddress: other })).entries
        .length,
      0,
    );
    assert.equal(
      (await repository.getSignatureHistory({ chainId: 8453 })).entries.length,
      0,
    );
    assert.equal(
      (await repository.getSignatureHistory({ from: entry.createdAt + 1 }))
        .entries.length,
      0,
    );
    const cryptoModule = await server.ssrLoadModule("/src/chrome/crypto.ts");
    const compact = JSON.parse(
      await cryptoModule.decryptWithVaultKey(key, stored.encrypted),
    );
    assert.equal("accountType" in compact, false);
    assert.equal(compact.accountId, "owner");
    assert.equal("ownerAddress" in compact, false);
    await assert.rejects(
      repository.prepareSignatureHistory({ ...entry, accountType: "ledger" }),
      /account integrity/,
    );
    const accountMetadata = await database.readStoredSignatureAccount("owner");
    assert.deepEqual(
      JSON.parse(
        await cryptoModule.decryptWithVaultKey(key, accountMetadata.encrypted),
      ),
      {
        id: "owner",
        address,
        type: "privateKey",
      },
    );
    const altered = { ...stored, id: "moved" };
    await database.putStoredSignature(altered);
    await assert.rejects(repository.getSignatureHistory(), /integrity/);
    await database.removeStoredSignature("moved");
    await history.putHistoryTransaction({
      id: "tx",
      status: "processing",
      createdAt: 1,
      chainId: 1,
      chainName: "Ethereum",
      origin: "wallet",
      favicon: null,
      tx: {
        from: address,
        to: other,
        value: "0x0",
        data: "0xdeadbeef",
        chainId: 1,
        authorizationList: [{ secret: "must-not-export" }],
      },
    });
    const safeAddress = `0x${"a".repeat(40)}`;
    const safeBuilder = await server.ssrLoadModule(
      "/src/chrome/safe/transactionBuilder.ts",
    );
    const built = safeBuilder.buildSafeTransaction({
      chainId: 1,
      safeAddress,
      safeVersion: "1.4.1",
      nonce: 1n,
      calls: [{ to: other, value: "2", data: "0xdeadbeef", operation: 0 }],
    });
    const rawOwnerSignature = `0x${"55".repeat(65)}`;
    harness.stores.local.safeProposals = {
      version: 1,
      records: [
        {
          version: 1,
          id: `1:${safeAddress}:${built.safeTxHash}`,
          chainId: 1,
          safeAccountId: "safe",
          safeAddress,
          safeTxHash: built.safeTxHash,
          safeVersion: "1.4.1",
          safeConfigEpoch: `0x${"12".repeat(32)}`,
          verifiedAtBlock: "12",
          calls: built.calls,
          transaction: built.transaction,
          state: "approvedLocally",
          confirmations: [
            {
              ownerAddress: address,
              signature: rawOwnerSignature,
              createdAt: 1,
            },
          ],
          route: { kind: "wallet" },
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    };
    for (const filter of [{}, {chainId: 8453}, {ownerAddress: address}, {ownerAddress: safeAddress}, {from: 2}, {from: 1, to: 1}]) {
      const summary = await exporter.getActivityHistorySummary(filter);
      const data = await exporter.exportActivity(filter);
      assert.equal(summary.transactionCount, data.transactions.length + data.safeTransactions.length);
    }
    const exported = await exporter.exportActivity({});
    assert.equal(exported.schemaVersion, 2);
    assert.equal(exported.accounts.owner.address, address);
    assert.equal(exported.accounts.owner.type, "privateKey");
    assert.equal(exported.accounts.owner.signatures.length, 1);
    for (const field of [
      "ownerAddress",
      "accountId",
      "accountType",
      "version",
    ]) {
      assert.equal(field in exported.accounts.owner.signatures[0], false);
    }
    assert.equal(exported.transactions.length, 1);
    assert.equal(exported.safeTransactions.length, 1);
    assert.equal(JSON.stringify(exported).includes(rawOwnerSignature), false);
    assert.equal(
      JSON.stringify(exported.safeTransactions).includes("deadbeef"),
      false,
    );
    const safeExport = await exporter.exportActivity({
      ownerAddress: safeAddress,
    });
    assert.equal(safeExport.safeTransactions.length, 1);
    assert.equal(safeExport.transactions.length, 0);
    assert.equal(Object.keys(safeExport.accounts).length, 0);
    assert.equal(JSON.stringify(exported).includes("must-not-export"), false);
    assert.equal("data" in exported.transactions[0].tx, false);
    assert.equal("signature" in exported.accounts.owner.signatures[0], false);
    for (const filter of [
      { ownerAddress: "bad" },
      { chainId: -1 },
      { from: 20, to: 10 },
      { from: Infinity },
    ]) {
      assert.throws(() => exporter.parseHistoryFilter(filter));
    }
    const start = (await repository.getSignatureHistory()).state
      .recordingStartedAt;
    await repository.clearSignatureHistory(other);
    assert.equal((await repository.getSignatureHistory()).entries.length, 1);
    await repository.clearSignatureHistory(address);
    assert.equal((await repository.getSignatureHistory()).entries.length, 0);
    assert.equal(await database.readStoredSignatureAccount("owner"), undefined);
    assert.equal(
      (await database.readSignatureState()).recordingStartedAt,
      start,
    );
    assert.equal((await history.readAllHistoryTransactions()).length, 1);
    // Byte-budget retention can be tested with small encrypted rows and explicit accounting.
    await database.putStoredSignature(
      {
        ...stored,
        id: "old",
        createdAt: 1,
        bytes: database.MAX_SIGNATURE_BYTES,
      },
      accountMetadata,
    );
    await database.putStoredSignature(
      { ...stored, id: "new", createdAt: 2 },
      accountMetadata,
    );
    assert.deepEqual(
      (await database.readStoredSignatures()).map(
        (row: { id: string }) => row.id,
      ),
      ["new"],
    );
    assert.equal((await database.readSignatureState()).prunedCount, 1);
    await database.clearSignatureDatabase(undefined, true);
    assert.equal((await database.readSignatureState()).prunedCount, 0);
    // Shared metadata counts once toward retention; deleting the final row removes it.
    const halfBudget = Math.floor(
      (database.MAX_SIGNATURE_BYTES - accountMetadata.bytes) / 2,
    );
    await database.putStoredSignature(
      { ...stored, id: "budget-a", bytes: halfBudget },
      accountMetadata,
    );
    await database.putStoredSignature(
      { ...stored, id: "budget-b", bytes: halfBudget },
      accountMetadata,
    );
    assert.equal((await database.readStoredSignatures()).length, 2);
    await database.clearSignatureDatabase(undefined, true);
    await database.putStoredSignature(
      {
        ...stored,
        id: "oversize",
        bytes: database.MAX_SIGNATURE_BYTES - accountMetadata.bytes + 1,
      },
      accountMetadata,
    );
    assert.equal((await database.readStoredSignatures()).length, 0);
    assert.equal(await database.readStoredSignatureAccount("owner"), undefined);
    await database.clearSignatureDatabase(undefined, true);
    for (const [index, type] of [
      "privateKey",
      "seedPhrase",
      "ledger",
      "trezor",
      "bankr",
    ].entries()) {
      const signerAddress = `0x${String(index + 3).repeat(40)}`;
      for (const suffix of ["a", "b"]) {
        await repository.commitSignatureHistory(
          await repository.prepareSignatureHistory({
            ...entry,
            id: `${type}-${suffix}`,
            accountId: type,
            accountType: type,
            ownerAddress: signerAddress,
          }),
        );
      }
    }
    const grouped = await exporter.exportActivity({});
    assert.equal(Object.keys(grouped.accounts).length, 5);
    for (const type of [
      "privateKey",
      "seedPhrase",
      "ledger",
      "trezor",
      "bankr",
    ]) {
      assert.equal(grouped.accounts[type].type, type);
      assert.equal(grouped.accounts[type].signatures.length, 2);
    }
    await repository.discardSignatureHistory("ledger-a");
    assert.ok(await database.readStoredSignatureAccount("ledger"));
    await repository.discardSignatureHistory("ledger-b");
    assert.equal(
      await database.readStoredSignatureAccount("ledger"),
      undefined,
    );
    assert.ok(await database.readStoredSignatureAccount("trezor"));
    await repository.clearSignatureHistory(`0x${"3".repeat(40)}`);
    assert.equal(
      await database.readStoredSignatureAccount("privateKey"),
      undefined,
    );
    assert.ok(await database.readStoredSignatureAccount("trezor"));
    await repository.clearSignatureHistory();
    assert.equal(
      await database.readStoredSignatureAccount("ledger"),
      undefined,
    );
    session.setCachedVaultKey(null);
    await assert.rejects(repository.getSignatureHistory(), /Unlock/);
    await assert.rejects(repository.prepareSignatureHistory(entry), /Unlock/);
    session.setCachedVaultKey(key);
    session.setCachedPasswordType("master");
    const pendingRead = repository.getSignatureHistory();
    await Promise.resolve();
    auth.invalidateAuthCeremonies();
    await assert.rejects(pendingRead, /locked/);
    await assert.rejects(
      repository.prepareSignatureHistory({
        ...entry,
        payload: "x".repeat(database.MAX_SIGNATURE_PAYLOAD_BYTES),
      }),
      /too large/,
    );
  } finally {
    await server.close();
    harness.restore();
    Object.assign(globalThis, {
      indexedDB: originalIdb,
      IDBKeyRange: originalRange,
    });
  }
});
