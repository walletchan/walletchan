import { lazy, Suspense } from "react";
import InitialRequestLoadingScreen from "./screens/InitialRequestLoadingScreen";
import { loadBunkerRequestScreen, loadedBunkerRequestScreen } from "./bunkerRequestPreload";
import type { BunkerAccountView } from "@/chrome/safeBunker/types";
import type { SafeBunkerAccount } from "@/chrome/types";
import AppFeatureFrame from "./AppFeatureFrame";
const LazyScreen = lazy(() => loadBunkerRequestScreen().then(m => ({ default: m.BunkerAccountScreen })));
export function BunkerAppSurface({ account, fullscreen, isPopup = false, initialRequestId, initialView, initialError, onBack, onSubmitted }: { account: SafeBunkerAccount; fullscreen: boolean; isPopup?: boolean; initialRequestId?: string | null; initialView?: BunkerAccountView | null; initialError?: string; onBack: () => void; onSubmitted: () => void }) {
  const Screen = loadedBunkerRequestScreen() ?? LazyScreen;
  return <AppFeatureFrame isFullscreenTab={fullscreen}><Suspense fallback={<InitialRequestLoadingScreen title="Transaction request" onBack={onBack} />}><Screen key={`${account.id}:${initialRequestId ?? "management"}`} account={account} isPopup={isPopup} initialRequestId={initialRequestId} initialView={initialView} initialError={initialError} onBack={onBack} onSubmitted={onSubmitted} /></Suspense></AppFeatureFrame>;
}
