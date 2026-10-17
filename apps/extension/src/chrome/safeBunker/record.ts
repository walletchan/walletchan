import { decodeBase64Exact, decodeBase64Bounded } from "../cryptography/base64";

export const BUNKER_DRAFT_VAULT_KEY = "safeBunkerDraftVault";
export const MAX_BUNKER_DRAFTS = 100;
export interface BunkerDraftHeader {
  id: string;
  name: string;
  chainId: 11155111;
  derivationVersion: 1;
  firstOwner: `0x${string}`;
  createdAt: number;
}
export interface BunkerCipher { iv: string; ciphertext: string }
export interface BunkerDraftEntry {
  header: BunkerDraftHeader;
  seed: BunkerCipher;
  wrappedKey: BunkerCipher;
}
export interface BunkerDraftVault { version: 1; entries: BunkerDraftEntry[] }
export type BunkerDraftSummary = Pick<BunkerDraftHeader, "id" | "name" | "chainId" | "createdAt">;

export function exactRecord(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== keys.length ||
      !keys.every((key) => Object.prototype.hasOwnProperty.call(value, key)))
    throw new Error("Invalid Bunker draft record");
  return value as Record<string, unknown>;
}
export function assertBunkerDraftId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^bunker-draft:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value))
    throw new Error("Invalid Bunker draft ID");
}
export function headerJson(header: BunkerDraftHeader): string {
  return JSON.stringify([header.id, header.name, header.chainId,
    header.derivationVersion, header.firstOwner, header.createdAt]);
}
function cipher(value: unknown, min: number, max: number): BunkerCipher {
  const c = exactRecord(value, ["iv", "ciphertext"]);
  if (!decodeBase64Exact(c.iv, 12) || !decodeBase64Bounded(c.ciphertext, min, max))
    throw new Error("Invalid Bunker ciphertext");
  return { iv: c.iv as string, ciphertext: c.ciphertext as string };
}
export function decodeBunkerDraftVault(value: unknown): BunkerDraftVault {
  if (value === undefined) return { version: 1, entries: [] };
  const vault = exactRecord(value, ["version", "entries"]);
  if (vault.version !== 1 || !Array.isArray(vault.entries) || vault.entries.length > MAX_BUNKER_DRAFTS)
    throw new Error("Unsupported Bunker draft vault");
  const ids = new Set<string>();
  const entries = vault.entries.map((value): BunkerDraftEntry => {
    const e = exactRecord(value, ["header", "seed", "wrappedKey"]);
    const h = exactRecord(e.header, ["id", "name", "chainId", "derivationVersion", "firstOwner", "createdAt"]);
    assertBunkerDraftId(h.id);
    if (ids.has(h.id) || typeof h.name !== "string" || h.name.length < 1 ||
        h.name.length > 64 || h.name.trim() !== h.name || h.chainId !== 11155111 ||
        h.derivationVersion !== 1 || typeof h.firstOwner !== "string" ||
        !/^0x[0-9a-f]{40}$/.test(h.firstOwner) ||
        !Number.isSafeInteger(h.createdAt) || (h.createdAt as number) < 0)
      throw new Error("Invalid Bunker draft header");
    ids.add(h.id);
    return { header: h as unknown as BunkerDraftHeader,
      seed: cipher(e.seed, 32, 528), wrappedKey: cipher(e.wrappedKey, 48, 48) };
  });
  return { version: 1, entries };
}
export function summarizeBunkerDraft(entry: BunkerDraftEntry): BunkerDraftSummary {
  const { id, name, chainId, createdAt } = entry.header;
  return { id, name, chainId, createdAt };
}
