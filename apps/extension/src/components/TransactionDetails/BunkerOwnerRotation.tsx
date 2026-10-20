import type { CompletedTransaction } from "@/chrome/txHistoryStorage";
import { OwnerRotationCard } from "@/components/shared/OwnerRotationCard";

export default function BunkerOwnerRotation({ tx, explorer }: { tx: CompletedTransaction; explorer?: string }) {
  const rotation = tx.safeBunkerMeta?.rotation;
  return rotation ? <OwnerRotationCard chainId={tx.chainId} rotation={rotation} explorer={explorer} /> : null;
}
