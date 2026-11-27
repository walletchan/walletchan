/** Additive v4 upgrade, called only by the shared history database owner. */
export function upgradeSignatureHistorySchema(database: IDBDatabase): void {
  if (!database.objectStoreNames.contains("signatures")) {
    const signatures = database.createObjectStore("signatures", {
      keyPath: "id",
    });
    signatures.createIndex("byCreated", ["createdAt", "id"]);
    signatures.createIndex("byOwnerCreated", [
      "ownerAddress",
      "createdAt",
      "id",
    ]);
  }
  if (!database.objectStoreNames.contains("signatureAccounts")) {
    database.createObjectStore("signatureAccounts", { keyPath: "id" });
  }
  if (!database.objectStoreNames.contains("signatureState")) {
    database.createObjectStore("signatureState");
  }
}
