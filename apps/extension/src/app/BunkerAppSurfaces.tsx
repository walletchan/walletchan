import { lazy, Suspense } from "react";
import InitialRequestLoadingScreen from "./screens/InitialRequestLoadingScreen";
import type { SafeBunkerAccount } from "@/chrome/types";
import AppFeatureFrame from "./AppFeatureFrame";
const Screen = lazy(() => import("@/components/SafeBunker/BunkerAccountScreen").then((m) => ({ default: m.BunkerAccountScreen })));
export function BunkerAppSurface({ account, fullscreen, initialRequestId, onBack, onSubmitted }: { account: SafeBunkerAccount; fullscreen: boolean; initialRequestId?: string | null; onBack: () => void; onSubmitted: () => void }) {
  return <AppFeatureFrame isFullscreenTab={fullscreen}><Suspense fallback={<InitialRequestLoadingScreen title="Transaction request" onBack={onBack} />}><Screen key={`${account.id}:${initialRequestId ?? "management"}`} account={account} initialRequestId={initialRequestId} onBack={onBack} onSubmitted={onSubmitted} /></Suspense></AppFeatureFrame>;
}
