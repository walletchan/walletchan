import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const webRoot = resolve(dirname(require.resolve("@trezor/connect-web")), "..");
const fromWeb = createRequire(resolve(webRoot, "package.json"));
const commonRoot = resolve(
  dirname(fromWeb.resolve("@trezor/connect-common")),
  "..",
);
const { ServiceWorkerWindowExtConnectableChannel: Channel } = await import(
  pathToFileURL(
    resolve(
      commonRoot,
      "lib/messageChannel/serviceworker-window-ext-connectable.js",
    ),
  ).href
);
const origin = "https://suite.trezor.io";
const url = `${origin}/web/connect-popup`;
const sender = { tab: { id: 7, url }, origin, url, frameId: 0 };
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("installed Suite channel accepts only its current top-level approval tab", async () => {
  let listener: Function = () => {};
  const accepted: unknown[] = [];
  Object.assign(globalThis, {
    chrome: {
      runtime: {
        onMessageExternal: {
          addListener: (fn: Function) => {
            listener = fn;
          },
          removeListener: () => {},
        },
      },
    },
  });
  const channel = new Channel({
    channel: { here: "extension", peer: "suite" },
    currentId: () => 7,
    allowedOrigin: origin,
  });
  channel.onMessage = (message: unknown) => accepted.push(message);
  channel.connect();
  const message = {
    channel: { here: "suite", peer: "extension" },
    id: "request",
  };
  listener(message, sender, () => {});
  for (const invalid of [null, undefined, false, [], "not-an-envelope"]) listener(invalid, sender, () => {});
  await tick();
  assert.equal(accepted.length, 1);
  for (const invalid of [
    { ...sender, tab: { id: 8, url } },
    { ...sender, frameId: 1 },
    { ...sender, origin: `${origin}.evil.test` },
    { ...sender, url: `${origin}/web/` },
    { ...sender, url: "https://suite.trezor.io.evil.test/web/connect-popup" },
    { ...sender, url: undefined },
    { ...sender, tab: undefined },
  ])
    listener(message, invalid, () => {});
  listener({ ...message, data: "x".repeat(2_100_001) }, sender, () => {});
  await tick();
  assert.equal(accepted.length, 1);
  channel.disconnect();
  listener(message, sender, () => {});
  await tick();
  assert.equal(accepted.length, 1);
});

test("installed Suite channel never appends a request to a navigated approval tab", async () => {
  let tabUrl = url;
  const updates: unknown[] = [];
  Object.assign(globalThis, {
    chrome: {
      runtime: { id: "walletchan" },
      tabs: {
        get: (_id: number, callback: Function) => callback({ url: tabUrl }),
        update: (...args: unknown[]) => updates.push(args),
      },
    },
  });
  const channel = new Channel({
    channel: { here: "extension", peer: "suite" },
    currentId: () => 7,
    allowedOrigin: origin,
  });
  await channel.doSend({ id: "first" });
  assert.equal(updates.length, 1);
  for (const invalid of [
    "https://example.com",
    `${origin}/web/`,
    "https://suite.trezor.io.evil.test/web/connect-popup",
    "https://user@suite.trezor.io/web/connect-popup",
  ]) {
    tabUrl = invalid;
    await assert.rejects(
      channel.doSend({ id: "secret-request" }),
      /authorized URL/,
    );
  }
  assert.equal(updates.length, 1);
});
