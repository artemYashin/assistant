import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { PullRequests } from "../server/pull-requests.js";

test("repository timeout defaults to five minutes, persists and survives rename", t => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-timeout-")), store = new Store(dir);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.set("settings", { ...store.rawSettings(), azureUrl: "https://ado.test/org", azureProject: "Azure" });
  const prs = new PullRequests(store, { active: () => null, chat: async () => ({ body: "", requestId: "" }) });
  const input = { client: "A", project: "B", repository: "repo", mode: "all" as const, enabled: true };
  prs.save(input);
  assert.equal(prs.monitors()[0].fetch_timeout_seconds, 300);
  assert.equal(prs.monitors()[0].code_sync_minutes, 30);
  prs.save({ ...input, codeSyncMinutes: 60 });
  prs.save({ ...input, fetchTimeoutSeconds: 900 });
  prs.save(input); // Older clients must not reset the saved timeout.
  assert.equal(prs.monitors()[0].fetch_timeout_seconds, 900);
  assert.equal(prs.monitors()[0].code_sync_minutes, 60);
  assert.throws(() => prs.save({ ...input, codeSyncMinutes: -1 }));
  assert.throws(() => prs.save({ ...input, codeSyncMinutes: 1441 }));
  assert.throws(() => prs.save({ ...input, fetchTimeoutSeconds: 0 }));
  assert.throws(() => prs.save({ ...input, fetchTimeoutSeconds: 1801 }));
  prs.save({ ...input, codeSyncMinutes: 0 });
  store.renameContext({ client: "A", project: "B" }, "Renamed");
  assert.equal(prs.monitors()[0].fetch_timeout_seconds, 900);
  assert.equal(prs.monitors()[0].code_sync_minutes, 0);
});
