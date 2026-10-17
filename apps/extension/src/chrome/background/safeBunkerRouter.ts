import { getPendingBunkerRequests } from "../safeBunker/pendingRequests";
import { bunkerPolicyMessage, bunkerStepMessage } from "../safeBunker/errors";
import { runBunkerEffect } from "../safeBunker/barrier";
import { handleUnlockWallet } from "../authHandlers";
import { getCachedVaultKey, getPasswordType, resolvePasswordType } from "../sessionCache";
import { isTrustedWalletUiSender } from "../trustedWalletUiSender";
import { createBunkerDraft } from "../safeBunker/drafts";
import { captureBunkerAccess } from "../safeBunker/access";
import { exactRecord } from "../safeBunker/record";
import { getAccountById } from "../accountStorage";
import { bunkerEntry } from "../safeBunker/live";
import { discoverBunker, addExistingBunker } from "../safeBunker/discovery";
import { saveSeedPhraseOnly } from "../mnemonic/savePhraseOnly";
import { bunkerNetworks, bunkerClient } from "../safeBunker/network";
import { prepareBunkerDeployment, estimateBunkerDeployment, deployBunker } from "../safeBunker/deployment";
import { confirmBunkerOperation, rejectBunkerOperation, reviewBunkerOperation, stateForAccount } from "../safeBunker/operations";
import { reconcileBunker, retryBunkerOperation } from "../safeBunker/reconciliation";
import { continueBunkerRecovery, createBunkerRecoveryOperation } from "../safeBunker/recovery";
import { synchronizeBunkerPendingIndex, findPendingBunkerAccount, drainBunkerInbox, findBunkerRequestAccount, projectBunkerView } from "../safeBunker/view";
import { readBunkerState } from "../safeBunker/stateRepository";
import { enqueueBunkerRequest } from "../safeBunker/inbox";
import { groupBunkerOperations, separateBunkerOperation, removeBunkerAccount, mutateBunker } from "../safeBunker/management";
import { validateSafeGasOverrides } from "../safe/executionGas";

import { BACKGROUND_SAFE_BUNKER_MESSAGE_TYPES } from "./safeBunkerMessageTypes";
export { BACKGROUND_SAFE_BUNKER_MESSAGE_TYPES } from "./safeBunkerMessageTypes";

const FIELDS: Record<(typeof BACKGROUND_SAFE_BUNKER_MESSAGE_TYPES)[number], string[]> = {
  getPendingSafeBunkerRequests: [], getPendingSafeBunkerAccount: [], getSafeBunkerNetworks: [], saveSeedPhraseOnly: ["generate", "mnemonic"], discoverSafeBunker: ["seedGroupId", "chainId"], addExistingSafeBunker: ["seedGroupId", "chainId"], createSafeBunkerDraft: ["seedGroupId", "chainId"], prepareSafeBunker: ["id"], estimateSafeBunkerDeployment: ["id", "payerId"],
  deploySafeBunker: ["id", "payerId", "gas", "remember"], getSafeBunkerView: ["id"], getSafeBunkerRequestAccount: ["requestId"],
  createSafeBunkerRequest: ["accountId", "chainId", "id", "calls"], reviewSafeBunkerRequest: ["accountId", "requestId", "payerId", "gas"],
  confirmSafeBunkerRequest: ["accountId", "requestId", "digest", "remember"], rejectSafeBunkerRequest: ["accountId", "requestId"],
  retrySafeBunkerRequest: ["accountId", "requestId"], reconcileSafeBunker: ["id"], createSafeBunkerRecovery: ["accountId"],
  continueSafeBunkerRecovery: ["id"],
  groupSafeBunkerRequests: ["accountId", "ids"], separateSafeBunkerRequest: ["accountId", "requestId"],
  removeSafeBunker: ["accountId", "backedUp"], clearSafeBunkerPayer: ["accountId"],
};
export function routeBackgroundSafeBunkerMessage(message: any, sender: chrome.runtime.MessageSender, sendResponse: (response: any) => void): { handled: false } | { handled: true; keepChannelOpen: boolean } {
  if (!Object.prototype.hasOwnProperty.call(FIELDS, message?.type)) return { handled: false };
  let responded = false;
  const reply = (value: unknown) => { if (!responded) { responded = true; sendResponse(value); } };
  if (!isTrustedWalletUiSender(sender)) { reply({ success: false, error: "Unauthorized" }); return { handled: true, keepChannelOpen: false }; }
  void runBunkerEffect(async () => {
    try {
      exactRecord(message, ["type", ...FIELDS[message.type as keyof typeof FIELDS]]);
      if (!getCachedVaultKey() || !getPasswordType()) await resolvePasswordType(handleUnlockWallet);
      const current = captureBunkerAccess(); current();
      let result: unknown;
      switch (message.type) {
        case "getPendingSafeBunkerRequests": await synchronizeBunkerPendingIndex(); result = { requests: await getPendingBunkerRequests() }; break;
        case "getPendingSafeBunkerAccount": result = { account: await findPendingBunkerAccount() }; break;
        case "getSafeBunkerNetworks": result = { networks: (await bunkerNetworks()).map(({ chainId, name, icon, nativeCurrency, explorer }) => ({ chainId, name, icon, nativeCurrency, explorer })) }; break;
        case "saveSeedPhraseOnly": result = { group: await saveSeedPhraseOnly(message) }; break;
        case "discoverSafeBunker": result = { discovery: await discoverBunker(message.seedGroupId, message.chainId) }; break;
        case "addExistingSafeBunker": result = { accountId: await addExistingBunker(message.seedGroupId, message.chainId) }; break;
        case "createSafeBunkerDraft": result = { draft: await createBunkerDraft(message.seedGroupId, message.chainId) }; break;
        case "prepareSafeBunker": result = { view: await projectBunkerView(await prepareBunkerDeployment(message.id, await clientForMessage(message))) }; break;
        case "estimateSafeBunkerDeployment": {
          const state = await readBunkerState(message.id, current()); if (!state) throw new Error("Prepare deployment first");
          result = await estimateBunkerDeployment(state, message.payerId, await clientForMessage(message)); break;
        }
        case "deploySafeBunker": {
          if (typeof message.remember !== "boolean") throw new Error("Invalid default payer choice"); validateSafeGasOverrides(message.gas);
          result = { view: await projectBunkerView(await deployBunker(message.id, message.payerId, message.gas, message.remember, await clientForMessage(message))) }; break;
        }
        case "getSafeBunkerView": {
          const before = await readBunkerState(message.id, current());
          if (before?.activated) await drainBunkerInbox(before.accountId);
          const state = await readBunkerState(message.id, current()); if (!state) throw new Error("Bunker is unavailable");
          result = { view: await projectBunkerView(state) }; break;
        }
        case "getSafeBunkerRequestAccount": result = { account: await findBunkerRequestAccount(message.requestId) }; break;
        case "createSafeBunkerRequest": result = { result: await enqueueBunkerRequest({ id: message.id, accountId: message.accountId, chainId: message.chainId, calls: message.calls,
          routes: [{ kind: "wallet", origin: "WalletChan", requestId: message.id }] }) }; break;
        case "reviewSafeBunkerRequest":
          await reviewBunkerOperation(message.accountId, message.requestId, message.payerId, await clientForMessage(message), message.gas ?? undefined);
          result = { view: await projectBunkerView(await stateForAccount(message.accountId)) }; break;
        case "confirmSafeBunkerRequest":
          if (typeof message.remember !== "boolean") throw new Error("Invalid payer choice");
          await confirmBunkerOperation(message.accountId, message.requestId, message.digest, message.remember, await clientForMessage(message));
          result = { view: await projectBunkerView(await stateForAccount(message.accountId)) }; break;
        case "rejectSafeBunkerRequest": await rejectBunkerOperation(message.accountId, message.requestId, () => { current(); reply({ success: true }); }); break;
        case "retrySafeBunkerRequest": await retryBunkerOperation(message.accountId, message.requestId, await clientForMessage(message)); break;
        case "reconcileSafeBunker": await reconcileBunker(message.id, await clientForMessage(message)); break;
        case "createSafeBunkerRecovery": result = { result: await createBunkerRecoveryOperation(message.accountId, await clientForMessage(message)) }; break;
        case "continueSafeBunkerRecovery": result = { view: await projectBunkerView(await continueBunkerRecovery(message.id, await clientForMessage(message))) }; break;
        case "groupSafeBunkerRequests": await groupBunkerOperations(message.accountId, message.ids); break;
        case "separateSafeBunkerRequest": await separateBunkerOperation(message.accountId, message.requestId); break;
        case "removeSafeBunker": await removeBunkerAccount(message.accountId, message.backedUp === true); break;
        case "clearSafeBunkerPayer": await mutateBunker(message.accountId, async (state) => { state.defaultPayer = null; }); break;
      }
      current(); reply({ success: true, ...(result as object ?? {}) });
    } catch (error) {
      // Fixed allowlisted error text: RPC failures can carry signed calldata or response bodies.

      reply({ success: false, error: bunkerStepMessage(error) ?? bunkerPolicyMessage(error) ?? (`Bunker operation unavailable. Unlock, check status and retry. [${message.type}]`) });
    }
  }).catch(() => reply({ success: false, error: "Wallet reset is in progress" }));
  return { handled: true, keepChannelOpen: true };
}

async function clientForMessage(message: { id?: string; accountId?: string }) {
  if (message.accountId) {
    const account = await getAccountById(message.accountId);
    if (account?.type !== "safeBunker") throw new Error("Bunker not found");
    return bunkerClient(account.chainId);
  }
  return bunkerClient((await bunkerEntry(message.id ?? "")).header.chainId);
}
