import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../services/backend/src/store.js";
import { overviewAudit } from "../services/backend/src/overview-activity.js";

test("activity resolves legacy PR actions and retains new PR titles after cleanup", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-activity-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  store.db
    .prepare(
      "INSERT INTO pull_requests(monitor,repo,number,title,author,url,head,target,draft,in_scope,synced_at) VALUES (?,?,?,'Useful title','','','','',0,1,'')",
    )
    .run("m", "r", 42);
  store.audit("pr.reviewed", "Project PR #42");
  assert.equal(overviewAudit(store)[0].pull_request.title, "Useful title");
  store.audit("pr.merged", "Merged", { monitor: "m", repo: "r", number: 42 });
  store.db.prepare("DELETE FROM pull_requests").run();
  const merged = overviewAudit(store).find((row) => row.action === "pr.merged");
  assert.equal(merged.pull_request.title, "Useful title");
  assert.equal(merged.detail, "Merged");
  store.audit("sync.completed", "Updated");
  assert.ok(overviewAudit(store).some((row) => row.action === "sync.completed"));
  assert.equal(overviewAudit(store, 1).length, 1);
});

test("legacy merge activity reads PR identity from saved plan body", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-activity-merge-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  store.db.exec("CREATE TABLE pr_merge_plans(id TEXT PRIMARY KEY,body TEXT)");
  store.db
    .prepare("INSERT INTO pr_merge_plans VALUES (?,?)")
    .run("plan", JSON.stringify({ monitor: "m", repo: "r", number: 42 }));
  store.audit("pr.merge.requested", JSON.stringify({ id: "plan" }));
  assert.deepEqual(overviewAudit(store)[0].pull_request, {
    monitor: "m",
    repo: "r",
    number: 42,
    title: "Название недоступно",
  });
});
