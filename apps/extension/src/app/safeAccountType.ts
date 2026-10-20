import type { Account } from "@/chrome/types";

type LegacyAccountType = Exclude<Account["type"], "safe" | "safeBunker">;

export function toLegacyAccountType(type: Account["type"] | undefined): LegacyAccountType | undefined {
  return type === "safe" || type === "safeBunker" ? undefined : type;
}
