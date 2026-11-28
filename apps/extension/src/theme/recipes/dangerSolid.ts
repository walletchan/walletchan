import type { ThemeTokens } from "../tokens";

/** Shared filled action for dedicated destructive confirmation surfaces. */
export function buildDangerSolid(t: ThemeTokens, pressActive: { transform: string; boxShadow?: string }) {
  return {
    bg: "status.error.emphasis",
    color: "fg.inverse",
    border: t.borders.thin,
    borderColor: "status.error.emphasis",
    _hover: { bg: "status.error.emphasis", opacity: 0.9, _disabled: { opacity: 0.5 } },
    _active: pressActive,
    _disabled: { opacity: 0.5, cursor: "not-allowed", transform: "none" },
  };
}
