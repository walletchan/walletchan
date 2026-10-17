export const BACKGROUND_SAFE_BUNKER_MESSAGE_TYPES = [
  "getPendingSafeBunkerRequests", "getPendingSafeBunkerAccount", "listSafeBunkerDrafts", "createSafeBunkerDraft", "prepareSafeBunker", "estimateSafeBunkerDeployment", "deploySafeBunker",
  "getSafeBunkerView", "getSafeBunkerRequestAccount", "createSafeBunkerRequest", "reviewSafeBunkerRequest", "confirmSafeBunkerRequest",
  "rejectSafeBunkerRequest", "retrySafeBunkerRequest", "reconcileSafeBunker", "createSafeBunkerRecovery", "restoreSafeBunker",
  "continueSafeBunkerRecovery", "groupSafeBunkerRequests", "separateSafeBunkerRequest", "removeSafeBunker", "clearSafeBunkerPayer",
] as const;
