import type { BunkerState } from "./types";

/** A public notification hint; never authorizes execution or carries signing data. */
export const BUNKER_REVERT_WARNINGS_KEY = "safeBunkerRevertWarningsV1";
export function hasBunkerRevertWarning(state: BunkerState): boolean {
  return state.activated && !state.archived && state.operations.some(op =>
    op.state === "reverted" && op.review?.ownerIndex === state.ownerIndex);
}
export function decodeBunkerRevertWarnings(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100 || value.some(id => typeof id !== "string" || !id || id.length > 256) || new Set(value).size !== value.length)
    throw new Error("Invalid Bunker revert warnings");
  return value;
}
export async function readBunkerRevertWarnings(): Promise<string[]> {
  return decodeBunkerRevertWarnings((await chrome.storage.local.get(BUNKER_REVERT_WARNINGS_KEY))[BUNKER_REVERT_WARNINGS_KEY]);
}
