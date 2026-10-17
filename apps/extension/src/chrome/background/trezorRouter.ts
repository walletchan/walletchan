/** Trusted-wallet-UI transport for Trezor connection and account discovery. */

export const BACKGROUND_TREZOR_MESSAGE_TYPES = [
  "trezorConnect",
  "trezorScan",
  "trezorCancel",
  "addTrezorAccounts",
  "getTrezorDevices",
] as const;

export type BackgroundTrezorRouteResult =
  | { handled: false }
  | { handled: true; keepChannelOpen: boolean };

export interface BackgroundTrezorDependencies {
  handleTrezorConnect(message: Record<string, unknown>): Promise<any>;
  handleTrezorScan(message: Record<string, unknown>): Promise<any>;
  handleTrezorCancel(message: Record<string, unknown>): Promise<any>;
  handleAddTrezorAccounts(message: Record<string, unknown>): Promise<any[]>;
  handleGetTrezorDevices(): Promise<any>;
}

const HANDLED_ASYNC: BackgroundTrezorRouteResult = {
  handled: true,
  keepChannelOpen: true,
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function createBackgroundTrezorMessageRouter(
  dependencies: BackgroundTrezorDependencies,
): (
  message: any,
  sendResponse: (response?: any) => void,
) => BackgroundTrezorRouteResult {
  return (message, sendResponse) => {
    const fail = (fallback: string) => (error: unknown) =>
      sendResponse({ success: false, error: errorMessage(error, fallback) });
    switch (message?.type) {
      case "trezorConnect":
        void dependencies
          .handleTrezorConnect(message)
          .then((device) => sendResponse({ success: true, ...device }))
          .catch(fail("Trezor connection failed"));
        return HANDLED_ASYNC;
      case "trezorScan":
        void dependencies
          .handleTrezorScan(message)
          .then((addresses) => sendResponse({ success: true, addresses }))
          .catch(fail("Trezor address scan failed"));
        return HANDLED_ASYNC;
      case "trezorCancel":
        void dependencies
          .handleTrezorCancel(message)
          .then(sendResponse)
          .catch(fail("Trezor cancellation failed"));
        return HANDLED_ASYNC;
      case "addTrezorAccounts":
        void dependencies
          .handleAddTrezorAccounts(message)
          .then((accounts) =>
            sendResponse({ success: true, accounts, account: accounts[0] }),
          )
          .catch(fail("Failed to add Trezor accounts"));
        return HANDLED_ASYNC;
      case "getTrezorDevices":
        void dependencies
          .handleGetTrezorDevices()
          .then(sendResponse)
          .catch(fail("Failed to load Trezor devices"));
        return HANDLED_ASYNC;
      default:
        return { handled: false };
    }
  };
}
