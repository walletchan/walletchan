import type { SignatureHistoryEntry } from "@/chrome/signatureHistory/types";
import type { PreviewEnvironment } from "./previewEnvironment";

const entriesByEnvironment = new WeakMap<
  PreviewEnvironment,
  SignatureHistoryEntry[]
>();
export function previewSignatureHistory(
  environment: PreviewEnvironment,
  message: any,
) {
  let entries = entriesByEnvironment.get(environment);
  if (!entries) {
    const account =
      environment.accounts.find((item) => item.type === "privateKey") ??
      environment.accounts[0];
    entries = account
      ? ["message", "siwe", "typedData"].map((kind, index) => ({
          version: 1,
          id: `preview-signature-${index}`,
          createdAt: Date.now() - index * 60_000,
          accountId: account.id,
          ownerAddress: account.address.toLowerCase(),
          accountType: "privateKey",
          origin: "https://example.org",
          source: "injected",
          chainId: 1,
          method: index < 2 ? "personal_sign" : "eth_signTypedData_v4",
          digest: `0x${"ab".repeat(32)}`,
          kind: kind as SignatureHistoryEntry["kind"],
          payload:
            index < 2
              ? "Preview signed message. This fixture never signs."
              : {
                  domain: { chainId: 1 },
                  primaryType: "Example",
                  message: { value: "100" },
                },
        }))
      : [];
    entriesByEnvironment.set(environment, entries);
  }
  const owner = message.filter?.ownerAddress?.toLowerCase();
  const state = { recordingStartedAt: Date.now() - 86400000, prunedCount: 0 };
  if (message.type === "clearSignatureHistory") {
    entriesByEnvironment.set(
      environment,
      owner ? entries.filter((entry) => entry.ownerAddress !== owner) : [],
    );
    return { success: true };
  }
  const signatures = entries.filter(
    (entry) =>
      (!owner || entry.ownerAddress === owner) &&
      (message.filter?.chainId == null ||
        entry.chainId === message.filter.chainId) &&
      (message.filter?.from == null ||
        entry.createdAt >= message.filter.from) &&
      (message.filter?.to == null || entry.createdAt <= message.filter.to),
  );
  return {
    success: true,
    data:
      message.type === "exportActivity"
        ? {
            schemaVersion: 1,
            application: "WalletChan",
            exportedAt: new Date().toISOString(),
            transactions: environment.txHistory,
            signatures,
          }
        : { entries: signatures, state },
  };
}
