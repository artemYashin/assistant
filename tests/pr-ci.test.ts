import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { PrCi } from "../server/pr-ci.js";
import { ciMergeReason } from "../server/pr-health.js";
test("CI metadata never downloads logs; logs must belong to PR and are bounded", async t => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-ci-")), store = new Store(dir);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.set("settings", { ...store.settings(), azureUrl: "https://ado.test", azureProject: "Project One" });
  store.setSecret("azure.pat", "pat");
  store.db.prepare("INSERT INTO pr_projects(id,client,project,source,azure_project,repository,mode,enabled) VALUES ('m','C','P','https://ado.test','Project One','r','all',1)").run();
  store.db.prepare("INSERT INTO pull_requests(monitor,repo,number,title,author,url,head,target,draft,in_scope,synced_at) VALUES ('m','r',1,'PR','A','','head','target',0,1,'')").run();
  let logs = 0;
  t.mock.method(globalThis, "fetch", async (raw: any) => {
    const url = new URL(String(raw));
    assert.ok(url.pathname.startsWith("/Project%20One/_apis/"));
    if (url.pathname.endsWith("/pullrequests/1")) return Response.json({ pullRequestId: 1, repository: { id: "r", project: { id: "pid" } }, lastMergeSourceCommit: { commitId: "head" }, lastMergeTargetCommit: { commitId: "target" } });
    if (url.pathname.endsWith("/policy/evaluations")) return Response.json({ value: [{ status: "approved", context: { buildId: 7 }, configuration: { settings: { buildDefinitionId: 3, displayName: "Build" } } }] });
    if (url.pathname.endsWith("/builds/7")) return Response.json({ id: 7, status: "completed", result: "succeeded" });
    if (url.pathname.endsWith("/timeline")) return Response.json({ records: [{ id: "step", name: "Test", log: { id: 2 } }] });
    if (url.pathname.endsWith("/logs/2")) { logs++; return new Response("x".repeat(300000)); }
    throw Error("Unexpected request " + raw);
  });
  const ci = new PrCi(store), key = { monitor: "m", repo: "r", number: 1 };
  assert.equal((await ci.checks(key)).builds[0].buildId, 7);
  assert.equal((await ci.timeline(key, 7)).records[0].logId, 2);
  assert.equal(logs, 0);
  await assert.rejects(ci.log(key, 8, 2), /не относится/);
  await assert.rejects(ci.log(key, 7, 3), /не относится/);
  assert.equal(logs, 0);
  const log = await ci.log(key, 7, 2);
  assert.equal(log.text.length, 256 * 1024); assert.equal(log.truncated, true); assert.equal(logs, 1);
  await assert.rejects(ci.checks({ ...key, repo: "other" }), /не найден/);
});
test("merge CI gate blocks unknown, failed and pending, permits approved and no configured builds", () => {
  for (const health of [null, "bad", { error: "Failed", checks: [] }, { checks: [{ build: true, state: "queued" }] }, { checks: [{ build: true, state: "rejected" }] }]) assert.ok(ciMergeReason(health));
  for (const checks of [[], [{ build: true, state: "approved" }], [{ build: true, state: "notApplicable" }], [{ build: false, state: "queued" }]]) assert.equal(ciMergeReason({ checks }), "");
});
