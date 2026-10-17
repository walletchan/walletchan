import assert from "node:assert/strict";
import test from "node:test";
import type { BunkerAccountView } from "../../src/chrome/safeBunker/types";
import { completeBunkerRestore } from "../../src/components/SafeBunker/restoreProgress";

const page = (progress: string, complete = false) => ({ draftId: "restore:1", id: "bunker:1", recovering: !complete, deployed: complete, recoveryProgress: progress }) as BunkerAccountView;

test("one restore action continues scan pages sequentially through completion", async () => {
  const pages = [page("second"), page("third"), page("done", true)];
  const progress: string[] = [];
  let pending = 0, authorizationChecks = 0;
  const result = await completeBunkerRestore(page("first"), {
    isCurrent: () => true,
    authorize: async () => { authorizationChecks++; return true; },
    continueRecovery: async (id) => {
      assert.equal(id, "restore:1"); assert.equal(pending++, 0);
      await Promise.resolve(); pending--; return pages.shift()!;
    },
    onProgress: (view) => progress.push(view.recoveryProgress!),
  });
  assert.equal(result?.deployed, true);
  assert.equal(authorizationChecks, 3);
  assert.deepEqual(progress, ["first", "second", "third", "done"]);
});

test("leaving during a pending page suppresses its UI result and further requests", async () => {
  let active = true, calls = 0;
  const progress: string[] = [];
  let release!: (view: BunkerAccountView) => void;
  const pending = new Promise<BunkerAccountView>((resolve) => { release = resolve; });
  const result = completeBunkerRestore(page("first"), {
    isCurrent: () => active, authorize: async () => true,
    continueRecovery: async () => { calls++; return pending; },
    onProgress: (view) => progress.push(view.recoveryProgress!),
  });
  await Promise.resolve(); active = false; release(page("second"));
  assert.equal(await result, null);
  assert.equal(calls, 1);
  assert.deepEqual(progress, ["first"]);
});

test("expired authorization pauses instead of continuing across an unlock", async () => {
  let authorized = false, calls = 0;
  assert.equal(await completeBunkerRestore(page("first"), {
    isCurrent: () => true, authorize: async () => authorized,
    continueRecovery: async () => { calls++; return page("done", true); }, onProgress: () => {},
  }), null);
  authorized = true;
  await Promise.resolve(); assert.equal(calls, 0);
});

test("a failed scan pauses without retrying or losing the last successful progress", async () => {
  let calls = 0;
  const progress: string[] = [];
  await assert.rejects(completeBunkerRestore(page("first"), {
    isCurrent: () => true, authorize: async () => true,
    continueRecovery: async () => { calls++; throw new Error("RPC unavailable"); },
    onProgress: (view) => progress.push(view.recoveryProgress!),
  }), /RPC unavailable/);
  assert.equal(calls, 1); assert.deepEqual(progress, ["first"]);
});

test("a completed checkpoint opens the account without another continuation", async () => {
  const completed = page("done", true);
  assert.equal(await completeBunkerRestore(completed, {
    isCurrent: () => true,
    authorize: async () => { throw new Error("No additional authorization is needed to display completed progress"); },
    continueRecovery: async () => { throw new Error("Already complete"); },
    onProgress: () => {},
  }), completed);
});
