/** Save a normal phrase group without deriving an ordinary EOA account. */
import { addSeedGroup, getSeedGroups, removeSeedGroup } from "../accountStorage";
import { resolveMasterMnemonicAccess } from "./masterAccess";
import { generateNewMnemonic, normalizeMnemonicForPersistence } from "./derivation";
import { getMnemonic, storeMnemonic } from "./operations";
import { assertCurrentMasterAuthorization } from "../masterAuthorization";
import { WALLET_SECRET_OPERATION_LOCK_KEY, withStorageLock } from "../storageLock";
export async function saveSeedPhraseOnly(input: { generate: boolean; mnemonic: string }) {
  if (typeof input.generate !== "boolean" || typeof input.mnemonic !== "string" || input.generate && input.mnemonic)
    throw new Error("Invalid seed phrase request");
  const access = await resolveMasterMnemonicAccess();
  if (!access.success) throw new Error(access.error);
  const mnemonic = input.generate ? generateNewMnemonic() : normalizeMnemonicForPersistence(input.mnemonic);
  if (!mnemonic) throw new Error("Enter a valid 12-word seed phrase");
  return withStorageLock(WALLET_SECRET_OPERATION_LOCK_KEY, async () => {
    assertCurrentMasterAuthorization(access.authEpoch);
    for (const group of await getSeedGroups()) {
      if (await getMnemonic(group.id, { password: access.password, mnemonicKey: access.mnemonicKey, legacyVaultKey: access.vaultKey }) === mnemonic) {
        assertCurrentMasterAuthorization(access.authEpoch); return group;
      }
    }
    const group = await addSeedGroup(undefined, access.authEpoch, input.generate);
    try {
      await storeMnemonic(group.id, mnemonic, access.mnemonicKey ? { kind: "mnemonic-key", ...access.mnemonicKey } :
        { kind: "password", password: access.password! }, access.authEpoch);
      assertCurrentMasterAuthorization(access.authEpoch);
      chrome.runtime.sendMessage({ type: "accountsUpdated" }).catch(() => {});
      return group;
    } catch (error) { await removeSeedGroup(group.id, access.authEpoch); throw error; }
  });
}
