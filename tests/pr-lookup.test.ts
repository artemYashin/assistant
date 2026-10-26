import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../services/backend/src/store.js";
import { PullRequests } from "../services/backend/src/pull-requests.js";
const repo = "22222222-2222-4222-8222-222222222222";
const project = "11111111-1111-4111-8111-111111111111";
const head = "a".repeat(40),
  target = "b".repeat(40);

test("exact lookup reads old and foreign PRs with shared diff/commit APIs without importing or changing existing data", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-pr-lookup-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  store.set("settings", {
    ...store.settings(),
    azureUrl: "https://ado.test/Collection",
    azureProject: "Original",
  });
  store.setSecret("azure.pat", "fixture");
  const prs = new PullRequests(store, {
    active: () => null,
    chat: async () => ({ body: "", requestId: "" }),
  });
  store.set("fixture-existing-values", { ids: [1, 2], notes: "retain", excluded: [3] });
  const before = store.db.prepare("SELECT * FROM kv ORDER BY key").all();
  let diffCalls = 0;
  let denied = false;
  t.mock.method(globalThis, "fetch", async (input: any) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://ado.test");
    if (url.pathname.endsWith("/git/pullrequests/42")) {
      if (denied) return Response.json({ message: "Not found" }, { status: 404 });
      return Response.json({
        pullRequestId: 42,
        status: "completed",
        title: "Old PR",
        description: "Full body",
        repository: { id: repo, name: "Repository", project: { id: project, name: "Foreign" } },
        lastMergeSourceCommit: { commitId: head },
        lastMergeTargetCommit: { commitId: target },
        sourceRefName: "refs/heads/feature",
        targetRefName: "refs/heads/main",
        closedDate: "2020-01-01T00:00:00Z",
      });
    }
    assert.ok(url.pathname.includes(`/${project}/_apis/git/repositories/${repo}/`));
    if (url.pathname.endsWith("/workitems")) return Response.json({ value: [{ id: "7" }] });
    if (url.pathname.endsWith("/diffs/commits")) {
      diffCalls++;
      return Response.json({ commonCommit: target, changes: [], allChangesIncluded: true });
    }
    if (url.pathname.endsWith("/pullRequests/42/commits"))
      return Response.json({
        value: [{ commitId: head, comment: "Change", author: { name: "Author" } }],
      });
    if (url.pathname.endsWith(`/commits/${head}`))
      return Response.json({ commitId: head, parents: [target], comment: "Change" });
    throw new Error(`Unexpected request ${url.pathname}`);
  });
  const result = await prs.lookup(42);
  const card = result.item;
  assert.equal(card.status, "completed");
  assert.equal(card.closedAt, "2020-01-01T00:00:00Z");
  assert.equal(card.description, "Full body");
  assert.equal(card.tickets[0].id, 7);
  const diff = await prs.viewDiff(card.monitor, repo, 42);
  assert.equal(diff.head, head);
  assert.equal(diff.canComment, false);
  assert.equal((await prs.viewDiff(card.monitor, repo, 42)).head, head);
  assert.equal(diffCalls, 1, "exact preview caches the diff until refreshed");
  assert.equal((await prs.commits(card.monitor, repo, 42)).commits[0].id, head);
  assert.equal((await prs.commitDiff(card.monitor, repo, 42, head)).head, head);
  assert.equal((await prs.counts(card.monitor, repo, 42)).commits.value, 1);
  await assert.rejects(prs.viewDiff(card.monitor, repo, 43), /устарел/);
  assert.equal(
    (store.db.prepare("SELECT count(*) n FROM pull_requests").get() as { n: number }).n,
    0,
  );
  assert.equal(
    (store.db.prepare("SELECT count(*) n FROM pr_projects").get() as { n: number }).n,
    0,
  );
  assert.equal(
    (store.db.prepare("SELECT count(*) n FROM pr_completed").get() as { n: number }).n,
    0,
  );
  assert.deepEqual(store.db.prepare("SELECT * FROM kv ORDER BY key").all(), before);
  denied = true;
  await assert.rejects(prs.lookup(42), /404/);
  store.setSecret("azure.pat", "changed");
  await assert.rejects(prs.viewDiff(card.monitor, repo, 42), /Подключение Azure изменилось/);
});

test("known active lookup keeps the ordinary card and preserves populated records", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-pr-known-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  store.set("settings", {
    ...store.settings(),
    azureUrl: "https://ado.test/Collection",
    azureProject: "Original",
  });
  store.setSecret("azure.pat", "fixture");
  const prs = new PullRequests(store, {
    active: () => null,
    chat: async () => ({ body: "", requestId: "" }),
  });
  store.db
    .prepare(
      "INSERT INTO pr_projects(id,client,project,source,azure_project,mode,enabled,repository) VALUES (?,?,?,?,?,?,?,?)",
    )
    .run(
      "existing",
      "Customer",
      "Project",
      "https://ado.test/Collection",
      "Original",
      "all",
      1,
      repo,
    );
  store.db
    .prepare(
      "INSERT INTO pull_requests(monitor,repo,number,title,author,url,head,target,draft,in_scope,synced_at,description) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      "existing",
      repo,
      42,
      "Saved title",
      "Author",
      "https://ado.test/pr/42",
      head,
      target,
      0,
      1,
      "2026-10-27",
      "Saved description",
    );
  const before = store.db.prepare("SELECT * FROM pull_requests").all();
  const detail = {
    pullRequestId: 42,
    status: "active",
    title: "New title",
    repository: { id: repo, name: "Repo", project: { id: project, name: "Original" } },
  };
  let linksFail = false;
  t.mock.method(globalThis, "fetch", async (input: any) => {
    if (String(input).includes("/workitems")) {
      if (linksFail) return Response.json({ message: "Denied" }, { status: 403 });
      return Response.json({ value: [] });
    }
    return Response.json(detail);
  });
  const active = await prs.lookup(42);
  assert.equal(active.href, `/pull-requests?monitor=existing&repo=${repo}&number=42`);
  assert.deepEqual(store.db.prepare("SELECT * FROM pull_requests").all(), before);
  detail.status = "abandoned";
  linksFail = true;
  const abandoned = await prs.lookup(42);
  assert.equal(abandoned.item.status, "abandoned");
  assert.match(abandoned.item.ticket_links_error, /403/);
  assert.deepEqual(store.db.prepare("SELECT * FROM pull_requests").all(), before);
  store.set("settings", { ...store.settings(), azureProject: "Changed" });
  await assert.rejects(
    prs.commits(abandoned.item.monitor, repo, 42),
    /Подключение Azure изменилось/,
  );
});
