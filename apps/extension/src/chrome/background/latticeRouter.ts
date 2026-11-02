/** Trusted-wallet-UI transport for Lattice pairing and account discovery. */

import { LATTICE_ROUTER_DEPENDENCIES } from "../lattice/accountHandlers";

export const BACKGROUND_LATTICE_MESSAGE_TYPES = [
  "latticeConnect",
  "latticePair",
  "latticeScan",
  "latticeCancel",
  "addLatticeAccounts",
  "getLatticeDevices",
] as const;

export type BackgroundLatticeRouteResult =
  | { handled: false }
  | { handled: true; keepChannelOpen: boolean };

export interface BackgroundLatticeDependencies {
  handleLatticeConnect(message: Record<string, unknown>): Promise<any>;
  handleLatticePair(message: Record<string, unknown>): Promise<any>;
  handleLatticeScan(message: Record<string, unknown>): Promise<any>;
  handleLatticeCancel(message: Record<string, unknown>): Promise<any>;
  handleAddLatticeAccounts(message: Record<string, unknown>): Promise<any[]>;
  handleGetLatticeDevices(): Promise<any>;
}

const HANDLED_ASYNC: BackgroundLatticeRouteResult = {
  handled: true,
  keepChannelOpen: true,
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** Production Lattice handlers by default; tests pass overrides. */
export function createBackgroundLatticeMessageRouter(
  overrides: Partial<BackgroundLatticeDependencies> = {},
): (
  message: any,
  sendResponse: (response?: any) => void,
) => BackgroundLatticeRouteResult {
  const dependencies: BackgroundLatticeDependencies = { ...LATTICE_ROUTER_DEPENDENCIES, ...overrides };
  return (message, sendResponse) => {
    const run = <T,>(work: () => Promise<T>, shape: (value: T) => unknown, fallback: string) => {
      void work()
        .then((value) => sendResponse(shape(value)))
        .catch((error: unknown) => sendResponse({ success: false, error: errorMessage(error, fallback) }));
      return HANDLED_ASYNC;
    };
    const spread = (value: object) => ({ success: true, ...value });
    switch (message?.type) {
      case "latticeConnect":
        return run(() => dependencies.handleLatticeConnect(message), spread, "Lattice connection failed");
      case "latticePair":
        return run(() => dependencies.handleLatticePair(message), spread, "Lattice pairing failed");
      case "latticeScan":
        return run(() => dependencies.handleLatticeScan(message), (addresses) => ({ success: true, addresses }), "Lattice address scan failed");
      case "latticeCancel":
        return run(() => dependencies.handleLatticeCancel(message), (value) => value, "Lattice cancellation failed");
      case "addLatticeAccounts":
        return run(
          () => dependencies.handleAddLatticeAccounts(message),
          (accounts) => ({ success: true, accounts, account: accounts[0] }),
          "Failed to add Lattice accounts",
        );
      case "getLatticeDevices":
        return run(() => dependencies.handleGetLatticeDevices(), (value) => value, "Failed to load Lattice devices");
      default:
        return { handled: false };
    }
  };
}
