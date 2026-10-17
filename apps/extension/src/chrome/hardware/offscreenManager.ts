const HARDWARE_OFFSCREEN_URL = "offscreen.html";
const HARDWARE_OFFSCREEN_IDLE_MS = 30_000;

export interface HardwareOffscreenManagerDependencies {
  getDocumentUrl(path: string): string;
  getOffscreenDocumentUrls(): Promise<string[]>;
  createOffscreenDocument(path: string): Promise<void>;
  closeOffscreenDocument(): Promise<void>;
  schedule(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  cancelScheduled(timer: ReturnType<typeof setTimeout>): void;
}

export interface HardwareOffscreenManager {
  ensureDocument(): Promise<void>;
  withRequest<T>(work: () => Promise<T>): Promise<T>;
}

/**
 * Owns the Ledger hardware-wallet offscreen document.
 *
 * Chrome permits one offscreen document per extension profile. Keeping request
 * accounting in one module prevents one Ledger request from closing the
 * document while another request still has an in-flight operation.
 */
export function createHardwareOffscreenManager(
  dependencies: HardwareOffscreenManagerDependencies,
  idleMs = HARDWARE_OFFSCREEN_IDLE_MS,
): HardwareOffscreenManager {
  let creationPromise: Promise<void> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let activeRequests = 0;

  const cancelIdleTeardown = () => {
    if (!idleTimer) return;
    dependencies.cancelScheduled(idleTimer);
    idleTimer = null;
  };

  const ensureDocument = async (): Promise<void> => {
    const documentUrl = dependencies.getDocumentUrl(HARDWARE_OFFSCREEN_URL);
    const existingUrls = await dependencies.getOffscreenDocumentUrls();
    if (existingUrls.includes(documentUrl)) return;

    if (!creationPromise) {
      creationPromise = dependencies
        .createOffscreenDocument(HARDWARE_OFFSCREEN_URL)
        .finally(() => {
          creationPromise = null;
        });
    }
    await creationPromise;
  };

  const scheduleTeardown = () => {
    if (activeRequests || idleTimer) return;
    idleTimer = dependencies.schedule(() => {
      idleTimer = null;
      if (activeRequests) return;
      void dependencies.closeOffscreenDocument().catch(() => undefined);
    }, idleMs);
  };

  const withRequest = async <T>(work: () => Promise<T>): Promise<T> => {
    cancelIdleTeardown();
    activeRequests += 1;
    try {
      await ensureDocument();
      return await work();
    } finally {
      activeRequests -= 1;
      scheduleTeardown();
    }
  };

  return { ensureDocument, withRequest };
}

const hardwareOffscreenManager = createHardwareOffscreenManager({
  getDocumentUrl: (path) => chrome.runtime.getURL(path),
  getOffscreenDocumentUrls: async () => {
    if (!chrome.offscreen || !chrome.runtime.getContexts) {
      throw new Error("Hardware wallets require Chrome 124 or newer.");
    }
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    });
    return contexts
      .map((context) => context.documentUrl)
      .filter((url): url is string => typeof url === "string");
  },
  createOffscreenDocument: async (path) => {
    if (!chrome.offscreen) {
      throw new Error("Hardware wallets require Chrome 124 or newer.");
    }
    await chrome.offscreen.createDocument({
      url: path,
      reasons: [
        chrome.offscreen.Reason.WORKERS,
      ],
      justification:
        "Communicate with Ledger hardware through the WebHID SDK",
    });
  },
  closeOffscreenDocument: async () => {
    if (chrome.offscreen) await chrome.offscreen.closeDocument();
  },
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  cancelScheduled: (timer) => clearTimeout(timer),
});

export const ensureHardwareOffscreen =
  hardwareOffscreenManager.ensureDocument;
export const withHardwareOffscreenRequest =
  hardwareOffscreenManager.withRequest;
