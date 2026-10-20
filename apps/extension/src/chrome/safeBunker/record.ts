import { assertBunkerChainId } from "./chainIdentity";
export const BUNKER_DRAFT_VAULT_KEY = "safeBunkerBindingsV2";
export const MAX_BUNKER_DRAFTS = 100;
export interface BunkerDraftHeader {
  id: string; seedGroupId: string; name: string; chainId: number;
  derivationVersion: 2; firstOwner: `0x${string}`; createdAt: number;
}
export interface BunkerCipher { iv: string; ciphertext: string }
export interface BunkerDraftEntry { header: BunkerDraftHeader }
export interface BunkerDraftVault { version: 2; entries: BunkerDraftEntry[] }
export type BunkerDraftSummary = BunkerDraftHeader;
export function exactRecord(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length ||
      !keys.every(key => Object.prototype.hasOwnProperty.call(value, key))) throw new Error("Invalid Bunker record");
  return value as Record<string, unknown>;
}
export function assertBunkerDraftId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^bunker-source:[1-9][0-9]{0,15}:0x[0-9a-f]{40}$/.test(value)) throw new Error("Invalid Bunker identity");
  assertBunkerChainId(Number(value.split(":")[1]));
}
export function headerJson(header: BunkerDraftHeader): string {
  return JSON.stringify([header.id, header.seedGroupId, header.name, header.chainId, header.derivationVersion, header.firstOwner, header.createdAt]);
}
export function decodeBunkerDraftVault(value: unknown): BunkerDraftVault {
  if (value === undefined) return { version: 2, entries: [] };
  const vault = exactRecord(value, ["version", "entries"]);
  if (vault.version !== 2 || !Array.isArray(vault.entries) || vault.entries.length > 100) throw new Error("Unsupported Bunker bindings");
  const ids = new Set<string>();
  const entries = vault.entries.map(value => {
    const e = exactRecord(value, ["header"]);
    const h = exactRecord(e.header, ["id", "seedGroupId", "name", "chainId", "derivationVersion", "firstOwner", "createdAt"]);
    assertBunkerDraftId(h.id); assertBunkerChainId(h.chainId as number);
    if (ids.has(h.id) || typeof h.name !== "string" || !h.name.trim() || h.name.length > 128 || h.derivationVersion !== 2 ||
      typeof h.firstOwner !== "string" || !/^0x[0-9a-f]{40}$/.test(h.firstOwner) ||
      h.id !== `bunker-source:${h.chainId}:${h.firstOwner}` || (typeof h.seedGroupId !== "string" || !h.seedGroupId || h.seedGroupId.length > 128) ||
      !Number.isSafeInteger(h.createdAt) || (h.createdAt as number) < 0) throw new Error("Invalid Bunker binding");
    ids.add(h.id); return { header: h as unknown as BunkerDraftHeader };
  });
  return { version: 2, entries };
}
export function summarizeBunkerDraft(entry: BunkerDraftEntry): BunkerDraftSummary { return { ...entry.header }; }
