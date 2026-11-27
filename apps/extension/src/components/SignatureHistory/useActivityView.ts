import { useEffect, useState } from "react";

export type ActivityView = "transactions" | "signatures";

/** Signature browsing belongs to one visit to the Activity tab. */
export function useActivityView(isActive: boolean) {
  const [view, setView] = useState<ActivityView>("transactions");
  useEffect(() => {
    if (!isActive) setView("transactions");
  }, [isActive]);
  return { view: isActive ? view : "transactions", setView } as const;
}
