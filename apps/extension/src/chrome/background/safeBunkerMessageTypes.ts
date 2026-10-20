export const BACKGROUND_SAFE_BUNKER_MESSAGE_TYPES = [
  "getSafeBunkerNetworks", "saveSeedPhraseOnly", "discoverSafeBunker", "addExistingSafeBunker",
  "getPendingSafeBunkerRequests", "getPendingSafeBunkerAccount", "createSafeBunkerDraft", "prepareSafeBunker", "estimateSafeBunkerDeployment", "deploySafeBunker",
  "getSafeBunkerView", "getSafeBunkerRequestAccount", "createSafeBunkerRequest", "reviewSafeBunkerRequest", "confirmSafeBunkerRequest",
  "rejectSafeBunkerRequest", "retrySafeBunkerRequest", "reconcileSafeBunker", "createSafeBunkerRecovery",
  "continueSafeBunkerRecovery", "groupSafeBunkerRequests", "separateSafeBunkerRequest", "removeSafeBunker", "clearSafeBunkerPayer",
] as const;
