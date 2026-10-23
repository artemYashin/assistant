import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { Agent } from "../server/agent.js";

function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-model-cache-"));
  const store = new Store(dir);
  let calls = 0;
  let fail = false;
  const agent = new Agent(
    store,
    () =>
      ({
        start: async () => {},
        stop: async () => {},
        listModels: async () => {
          calls++;
          if (fail) throw new Error("unavailable");
          return [{ id: `model-${calls}` }];
        },
      }) as any,
  );
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    store,
    agent,
    calls: () => calls,
    fail: (value: boolean) => {
      fail = value;
    },
  };
}

test("model list shares concurrent requests and expires after one day", async (t) => {
  const f = fixture(t);
  let now = 1000;
  t.mock.method(Date, "now", () => now);
  const results = await Promise.all([
    f.agent.models(),
    f.agent.models(),
    f.agent.models(),
  ]);
  assert.equal(f.calls(), 1);
  assert.deepEqual(results[0], results[2]);
  now += 86400000 - 1;
  await f.agent.models();
  assert.equal(f.calls(), 1);
  now++;
  await f.agent.models();
  assert.equal(f.calls(), 2);
});

test("model list invalidates on changed credentials and does not cache errors", async (t) => {
  const f = fixture(t);
  await f.agent.models();
  f.store.setSecret("github.token", "different-account");
  await f.agent.models();
  assert.equal(f.calls(), 2);
  f.store.setSecret("github.token", "another-account");
  f.fail(true);
  await assert.rejects(f.agent.models());
  f.fail(false);
  await f.agent.models();
  assert.equal(f.calls(), 4);
});
