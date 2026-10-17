import { getPendingBunkerRequests } from "../safeBunker/pendingRequests";
import { bunkerPolicyMessage, bunkerStepMessage } from "../safeBunker/errors";
import { runBunkerEffect } from "../safeBunker/barrier";
import { handleUnlockWallet } from "../authHandlers";
import { getCachedVaultKey, getPasswordType, resolvePasswordType } from "../sessionCache";
import { isTrustedWalletUiSender } from "../trustedWalletUiSender";
import { createBunkerDraft, listBunkerDrafts } from "../safeBunker/drafts";
import { captureBunkerAccess } from "../safeBunker/access";
import { exactRecord } from "../safeBunker/record";
import { bunkerClient } from "../safeBunker/network";
import { prepareBunkerDeployment, estimateBunkerDeployment, deployBunker } from "../safeBunker/deployment";
import { confirmBunkerOperation, rejectBunkerOperation, reviewBunkerOperation, stateForAccount } from "../safeBunker/operations";
import { reconcileBunker, retryBunkerOperation } from "../safeBunker/reconciliation";
import { continueBunkerRecovery, createBunkerRecoveryOperation, restoreBunker } from "../safeBunker/recovery";
import { synchronizeBunkerPendingIndex, findPendingBunkerAccount, drainBunkerInbox, findBunkerRequestAccount, projectBunkerView } from "../safeBunker/view";
import { readBunkerState } from "../safeBunker/stateRepository";
import { enqueueBunkerRequest } from "../safeBunker/inbox";
import { groupBunkerOperations, separateBunkerOperation, removeBunkerAccount, mutateBunker } from "../safeBunker/management";
import { validateSafeGasOverrides } from "../safe/executionGas";

import { BACKGROUND_SAFE_BUNKER_MESSAGE_TYPES } from "./safeBunkerMessageTypes";
export { BACKGROUND_SAFE_BUNKER_MESSAGE_TYPES } from "./safeBunkerMessageTypes";

const FIELDS: Record<(typeof BACKGROUND_SAFE_BUNKER_MESSAGE_TYPES)[number], string[]> = {
  getPendingSafeBunkerRequests: [], getPendingSafeBunkerAccount: [], listSafeBunkerDrafts: [], createSafeBunkerDraft: ["id", "name"], prepareSafeBunker: ["id"], estimateSafeBunkerDeployment: ["id", "payerId"],
  deploySafeBunker: ["id", "payerId", "gas", "remember"], getSafeBunkerView: ["id"], getSafeBunkerRequestAccount: ["requestId"],
  createSafeBunkerRequest: ["accountId", "chainId", "id", "calls"], reviewSafeBunkerRequest: ["accountId", "requestId", "payerId", "gas"],
  confirmSafeBunkerRequest: ["accountId", "requestId", "digest", "remember"], rejectSafeBunkerRequest: ["accountId", "requestId"],
  retrySafeBunkerRequest: ["accountId", "requestId"], reconcileSafeBunker: ["id"], createSafeBunkerRecovery: ["accountId"],
  restoreSafeBunker: ["id", "seed", "address", "deploymentHash"], continueSafeBunkerRecovery: ["id"],
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
        case "listSafeBunkerDrafts": result = { drafts: await listBunkerDrafts() }; break;
        case "createSafeBunkerDraft": result = { draft: await createBunkerDraft(message.id, message.name) }; break;
        case "prepareSafeBunker": result = { view: await projectBunkerView(await prepareBunkerDeployment(message.id, await bunkerClient())) }; break;
        case "estimateSafeBunkerDeployment": {
          const state = await readBunkerState(message.id, current()); if (!state) throw new Error("Prepare deployment first");
          result = await estimateBunkerDeployment(state, message.payerId, await bunkerClient()); break;
        }
        case "deploySafeBunker": {
          if (typeof message.remember !== "boolean") throw new Error("Invalid default payer choice"); validateSafeGasOverrides(message.gas);
          result = { view: await projectBunkerView(await deployBunker(message.id, message.payerId, message.gas, message.remember, await bunkerClient())) }; break;
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
          await reviewBunkerOperation(message.accountId, message.requestId, message.payerId, await bunkerClient(), message.gas ?? undefined);
          result = { view: await projectBunkerView(await stateForAccount(message.accountId)) }; break;
        case "confirmSafeBunkerRequest":
          if (typeof message.remember !== "boolean") throw new Error("Invalid payer choice");
          await confirmBunkerOperation(message.accountId, message.requestId, message.digest, message.remember, await bunkerClient());
          result = { view: await projectBunkerView(await stateForAccount(message.accountId)) }; break;
        case "rejectSafeBunkerRequest": await rejectBunkerOperation(message.accountId, message.requestId, () => { current(); reply({ success: true }); }); break;
        case "retrySafeBunkerRequest": await retryBunkerOperation(message.accountId, message.requestId, await bunkerClient()); break;
        case "reconcileSafeBunker": await reconcileBunker(message.id, await bunkerClient()); break;
        case "createSafeBunkerRecovery": result = { result: await createBunkerRecoveryOperation(message.accountId, await bunkerClient()) }; break;
        case "restoreSafeBunker": {
          const input = { id: message.id, seed: message.seed, address: message.address, deploymentHash: message.deploymentHash };
          result = { view: await projectBunkerView(await restoreBunker(input, await bunkerClient())) }; break;
        }
        case "continueSafeBunkerRecovery": result = { view: await projectBunkerView(await continueBunkerRecovery(message.id, await bunkerClient())) }; break;
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
