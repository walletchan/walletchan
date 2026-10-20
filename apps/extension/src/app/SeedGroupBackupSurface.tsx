import AppFeatureFrame from "./AppFeatureFrame";
import RevealSeedPhrase from "@/components/RevealSeedPhrase";
export function SeedGroupBackupSurface({ seedGroupId, fullscreen, onBack }: { seedGroupId: string; fullscreen: boolean; onBack: () => void }) {
  return <AppFeatureFrame isFullscreenTab={fullscreen}><RevealSeedPhrase account={null} seedGroupIdOverride={seedGroupId} onBack={onBack} /></AppFeatureFrame>;
}
