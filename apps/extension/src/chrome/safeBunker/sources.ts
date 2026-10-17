/** Master-only scoped access to an existing mnemonic; no Bunker key/phrase copy. */
import { getSeedGroups } from "../accountStorage";
import { getMnemonic } from "../mnemonic/operations";
import { resolveMasterMnemonicAccess } from "../mnemonic/masterAccess";
import { assertCurrentMasterAuthorization } from "../masterAuthorization";
import { captureBunkerAccess } from "./access";
export async function withBunkerSourcePhrase<T>(seedGroupId: string, use: (phrase: string) => T | Promise<T>): Promise<T> {
  const current = captureBunkerAccess(); current();
  const access = await resolveMasterMnemonicAccess();
  if (!access.success) throw new Error(access.error);
  if (!(await getSeedGroups()).some(group => group.id === seedGroupId)) throw new Error("Seed phrase not found");
  const phrase = await getMnemonic(seedGroupId, { password: access.password, mnemonicKey: access.mnemonicKey, legacyVaultKey: access.vaultKey });
  assertCurrentMasterAuthorization(access.authEpoch); current();
  if (!phrase) throw new Error("Unlock the source seed phrase");
  const result = await use(phrase);
  assertCurrentMasterAuthorization(access.authEpoch); current();
  return result;
}
