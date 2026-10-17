import { getAuthCeremonyEpoch, isCurrentAuthCeremonyEpoch } from "../authTransition";
import { getCachedVaultKey, getPasswordType } from "../sessionCache";
export function captureBunkerAccess(master = false) {
  const epoch = getAuthCeremonyEpoch(); const key = getCachedVaultKey(); const role = getPasswordType();
  return () => {
    if (!key || !role || (master && role !== "master") || !isCurrentAuthCeremonyEpoch(epoch) ||
      getCachedVaultKey() !== key || getPasswordType() !== role) throw new Error("Authentication changed. Unlock and retry.");
    return key;
  };
}
export type BunkerAccess = ReturnType<typeof captureBunkerAccess>;
