import assert from "node:assert/strict";
import test from "node:test";
import {
  createHardwareOffscreenManager,
  type HardwareOffscreenManagerDependencies,
} from "../../src/chrome/hardware/offscreenManager";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("concurrent hardware requests share one document and one idle teardown", async () => {
  const documentUrl = "chrome-extension://walletchan/offscreen.html";
  const timers: Array<() => void> = [];
  let created = false;
  let createCount = 0;
  let closeCount = 0;
  const dependencies: HardwareOffscreenManagerDependencies = {
    getDocumentUrl: () => documentUrl,
    getOffscreenDocumentUrls: async () => (created ? [documentUrl] : []),
    createOffscreenDocument: async () => {
      createCount += 1;
      created = true;
    },
    closeOffscreenDocument: async () => {
      closeCount += 1;
      created = false;
    },
    schedule: (callback) => {
      timers.push(callback);
      return timers.length as ReturnType<typeof setTimeout>;
    },
    cancelScheduled: () => undefined,
  };
  const manager = createHardwareOffscreenManager(dependencies, 10);
  const first = deferred<string>();
  const second = deferred<string>();

  const firstRequest = manager.withRequest(() => first.promise);
  const secondRequest = manager.withRequest(() => second.promise);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(createCount, 1);

  first.resolve("first");
  assert.equal(await firstRequest, "first");
  assert.equal(timers.length, 0);
  assert.equal(closeCount, 0);

  second.resolve("second");
  assert.equal(await secondRequest, "second");
  assert.equal(timers.length, 1);
  timers[0]();
  await Promise.resolve();
  assert.equal(closeCount, 1);
});
