import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { PrSourcePreparation } from "../server/pr-source.js";
const monitor: any = { id: "m", client: "C", project: "P" };
const pr = { monitor: "m", repo: "r", number: 1, head: "a".repeat(40), source_branch: "refs/heads/feature" };
function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "pr-source-"));
  const store = new Store(dir);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  return store;
}
test("ready matching snapshots need no fetch and a moved branch becomes stale", async t => {
  const store = fixture(t), calls: any[] = [];
  const prep = new PrSourcePreparation(store, { request: async input => { calls.push(input); return { sha: pr.head }; } });
  assert.equal(prep.status(pr).status, "unknown");
  await prep.prepare(monitor, pr);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].revision, pr.head);
  assert.equal(calls[0].localOnly, true);
  assert.equal(calls[0].monitor, monitor.id);
  assert.equal(prep.status(pr).status, "ready");
  assert.equal(prep.status({ ...pr, head: "b".repeat(40) }).status, "stale");
  store.set("code.snapshot:m:feature", { sha: "b".repeat(40) });
  assert.equal(prep.status(pr).status, "stale");
});
test("concurrent preparation waits for one pull, and rejects the wrong commit", async t => {
  const store = fixture(t);
  let finish!: () => void, pulls = 0;
  const wait = new Promise<void>(resolve => { finish = resolve; });
  let sha = pr.head;
  const prep = new PrSourcePreparation(store, { request: async (input: any) => {
    if (input.revision) return { sha: input.revision };
    if (input.localOnly) throw new Error("not cached");
    pulls++; await wait; return { sha };
  } });
  const first = prep.prepare(monitor, pr), second = prep.prepare(monitor, pr);
  assert.equal(prep.status(pr).status, "loading");
  finish(); await Promise.all([first, second]);
  assert.equal(pulls, 1); assert.equal(prep.status(pr).status, "ready");
  sha = "b".repeat(40);
  await assert.rejects(() => prep.prepare(monitor, pr), /отличается от коммита/);
  assert.equal(prep.status(pr).status, "error");
});
