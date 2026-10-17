import assert from "node:assert/strict";
import test from "node:test";
import {
  isTrustedHardwareBackgroundSender,
} from "../../src/offscreen/messageAuthorization";

const extensionRoot = "chrome-extension://walletchan/";
const extensionId = "walletchan";

test("Ledger offscreen accepts only the exact extension service worker", () => {
  assert.equal(
    isTrustedHardwareBackgroundSender(
      {
        id: extensionId,
        url: `${extensionRoot}static/js/background.js`,
      },
      extensionRoot,
      extensionId,
    ),
    true,
  );
});

test("Trezor official pages and every other sender remain untrusted", () => {
  const rejected: chrome.runtime.MessageSender[] = [
    {
      id: extensionId,
      url: `${extensionRoot}static/js/background.js`,
      tab: { id: 7 } as chrome.tabs.Tab,
    },
    { id: extensionId, url: `${extensionRoot}index.html` },
    { id: extensionId, url: `${extensionRoot}trezor-usb-permissions.html` },
    { id: extensionId, url: `${extensionRoot}static/js/background.js#fake` },
    { id: extensionId, url: `${extensionRoot}static/js/background.js?fake=1` },
    { id: extensionId, url: "https://suite.trezor.io/web/connect-popup" },
    { id: "other-extension", url: `${extensionRoot}static/js/background.js` },
    { id: extensionId },
  ];

  for (const sender of rejected) {
    assert.equal(
      isTrustedHardwareBackgroundSender(sender, extensionRoot, extensionId),
      false,
    );
  }
});
