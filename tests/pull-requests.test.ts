import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { PullRequests, requiredReviewer } from "../server/pull-requests.js";
const context = { client: "Client", project: "Portal" };
const pr = (id = 1, head = "head") => ({
  pullRequestId: id,
  title: "Change",
  status: "active",
  repository: { id: "repo" },
  createdBy: { displayName: "Dev" },
  lastMergeSourceCommit: { commitId: head },
  lastMergeTargetCommit: { commitId: "target" },
  reviewers: [{ id: "me", isRequired: true }],
});
function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-pr-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  store.set("settings", {
    ...store.settings(),
    azureUrl: "https://ado.test/tfs/Collection",
    azureProject: "Default",
  });
  store.setSecret("azure.pat", "test-pat");
  store.setSecret("github.token", "test-token");
  const calls: any[] = [];
  const agent = {
    active: () => null,
    chat: async (...args: any[]) => {
      calls.push(args);
      return {
        body: "Итог: обнаружена ошибка",
        requestId: "00000000-0000-0000-0000-000000000000" as const,
      };
    },
  };
  const service = new PullRequests(store, agent);
  service.save({
    ...context,
    azure_project: "Project One",
    repository: "repo",
    mode: "required",
    enabled: true,
  });
  return { store, service, calls, agent, dir };
}
function mock(t: any, items: any[], extra?: (url: URL) => any) {
  t.mock.method(globalThis, "fetch", async (raw: any, init: any) => {
    const url = new URL(String(raw));
    assert.equal(url.origin, "https://ado.test");
    assert.equal(
      init.headers.Authorization,
      `Basic ${Buffer.from(":test-pat").toString("base64")}`,
    );
    let data: any = extra?.(url);
    if (data instanceof Response) return data;
    if (data === undefined) {
      if (url.pathname.endsWith("connectionData"))
        data = { authenticatedUser: { id: "me" } };
      else if (url.pathname.endsWith("/pullrequests")) data = { value: items };
      else if (/\/pullrequests\/\d+$/.test(url.pathname))
        data = items.find(
          (p) => p.pullRequestId === Number(url.pathname.split("/").pop()),
        );
      else if (url.pathname.endsWith("/diffs/commits")) {
        assert.equal(url.searchParams.get("diffCommonCommit"), "true");
        data = {
          commonCommit: "base",
          allChangesIncluded: true,
          changes: [{ changeType: "edit", item: { path: "/app.ts" } }],
        };
      } else if (url.pathname.endsWith("/items"))
        data = {
          content:
            url.searchParams.get("versionDescriptor.version") === "base"
              ? "const enabled = false;\n"
              : "const enabled = true;\n",
        };
      else throw new Error("unexpected URL " + url);
    }
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}
test("required reviewer filter excludes optional reviewers and groups", () => {
  assert.ok(requiredReviewer(pr(), "ME"));
  assert.ok(
    !requiredReviewer(
      { ...pr(), reviewers: [{ id: "me", isRequired: false }] },
      "me",
    ),
  );
  assert.ok(
    !requiredReviewer(
      {
        ...pr(),
        reviewers: [{ id: "me", isRequired: true, isContainer: true }],
      },
      "me",
    ),
  );
});
test("PR sync scopes by project, deduplicates versions, waits for drafts, and builds real diff", async (t) => {
  const { store, service, calls } = fixture(t);
  const items = [
    pr(),
    { ...pr(2), reviewers: [{ id: "me", isRequired: false }] },
    { ...pr(3), isDraft: true },
  ];
  mock(t, items);
  await service.sync();
  await service.sync();
  assert.equal(
    (store.db.prepare("SELECT count(*) n FROM pr_reviews").get() as any).n,
    0,
  );
  await service.reviewNext();
  assert.equal(calls.length, 0);
  service.requestReview(service.monitors()[0].id, "repo", 1);
  assert.equal(service.list(context).length, 2);
  assert.equal(service.list({ client: "Other", project: "" }).length, 0);
  assert.equal(
    (store.db.prepare("SELECT count(*) n FROM pr_reviews").get() as any).n,
    1,
  );
  await service.reviewNext();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][2], true);
  assert.deepEqual(calls[0][1], context);
  assert.match(calls[0][0], /@@/);
  assert.match(calls[0][0], /-const enabled = false/);
  assert.match(calls[0][0], /\+const enabled = true/);
  await service.sync();
  await service.reviewNext();
  assert.equal(calls.length, 1);
  items[0] = pr(1, "new-head");
  await service.sync();
  service.requestReview(service.monitors()[0].id, "repo", 1);
  await service.reviewNext();
  assert.equal(calls.length, 2);
  assert.equal(
    (service.list(context) as any[]).find((p) => p.number === 1).head,
    "new-head",
  );
});
test("all mode includes optional and unassigned PRs; failed scans preserve prior membership", async (t) => {
  const { store, service } = fixture(t);
  service.save({
    ...context,
    azure_project: "Project One",
    repository: "repo",
    mode: "all",
    enabled: true,
  });
  const items = [{ ...pr(), reviewers: [] }];
  let fail = false;
  mock(t, items, (url) =>
    fail && url.pathname.endsWith("/pullrequests")
      ? new Response("", { status: 403 })
      : undefined,
  );
  await service.sync();
  assert.equal(service.list(context).length, 1);
  fail = true;
  await service.sync();
  assert.equal((service.list(context)[0] as any).in_scope, 1);
  assert.match((service.monitors()[0] as any).error, /403/);
});
test("daily cap and foreground chat defer reviews; errors are not retried automatically", async (t) => {
  const { store, service, agent } = fixture(t);
  mock(t, [pr(), pr(2)]);
  await service.sync();
  service.requestReview(service.monitors()[0].id, "repo", 1);
  service.requestReview(service.monitors()[0].id, "repo", 2);
  let busy = true;
  agent.active = () => (busy ? "user-request" : (null as any));
  await service.reviewNext();
  assert.equal(
    (
      store.db
        .prepare("SELECT count(*) n FROM pr_reviews WHERE status='queued'")
        .get() as any
    ).n,
    2,
  );
  busy = false;
  let tries = 0;
  agent.chat = async () => {
    tries++;
    throw new Error("provider failed");
  };
  store.set("settings", { ...store.settings(), prDailyLimit: 1 });
  await service.reviewNext();
  await service.reviewNext();
  assert.equal(tries, 1);
  const failed = store.db
    .prepare("SELECT * FROM pr_reviews WHERE status='error'")
    .get() as any;
  service.requestReview(failed.monitor, failed.repo, failed.number);
  await service.reviewNext();
  assert.equal(tries, 1, "manual retry must not reset the daily attempt cap");
  store.db
    .prepare("UPDATE pr_reviews SET status='error' WHERE id=?")
    .run(failed.id);
  assert.equal(
    (
      store.db
        .prepare("SELECT count(*) n FROM pr_reviews WHERE status='error'")
        .get() as any
    ).n,
    1,
  );
});
test("binary and truncated diffs are explicitly marked incomplete", async (t) => {
  const { service } = fixture(t);
  mock(t, [], (url) =>
    url.pathname.endsWith("/diffs/commits")
      ? {
          commonCommit: "base",
          allChangesIncluded: false,
          changes: [
            { changeType: "add", item: { path: "/image.png" } },
            { changeType: "rename", item: { path: "/renamed.ts" } },
          ],
        }
      : url.pathname.endsWith("/items")
        ? { contentMetadata: { isBinary: true } }
        : undefined,
  );
  const result = await service.changes(
    service.monitors()[0],
    "repo",
    "head",
    "target",
  );
  assert.equal(result.patches.length, 0);
  assert.equal(result.notes.length, 3);
});
test("closed or updated PR is not sent to LLM from an old queued version", async (t) => {
  const { service, calls } = fixture(t);
  const items = [pr()];
  mock(t, items);
  await service.sync();
  service.requestReview(service.monitors()[0].id, "repo", 1);
  items[0] = { ...pr(), status: "completed" };
  await service.reviewNext();
  assert.equal(calls.length, 0);
  assert.equal((service.list(context)[0] as any).review_status, "outdated");
});
test("interrupted review is retained without auto-resubmission on restart", async (t) => {
  const { store, service, dir } = fixture(t);
  mock(t, [pr()]);
  await service.sync();
  service.requestReview(service.monitors()[0].id, "repo", 1);
  store.db.prepare("UPDATE pr_reviews SET status='running'").run();
  const other = new Store(dir);
  try {
    assert.equal(
      (other.db.prepare("SELECT status FROM pr_reviews").get() as any).status,
      "interrupted",
    );
  } finally {
    other.close();
  }
});

test("legacy automatic queue is cancelled once and manual requests deduplicate", async (t) => {
  const { store, service, dir } = fixture(t);
  mock(t, [pr()]);
  await service.sync();
  const id = service.requestReview(service.monitors()[0].id, "repo", 1);
  assert.equal(service.requestReview(service.monitors()[0].id, "repo", 1), id);
  store.set("migration.manualReviews", false);
  const reopened = new Store(dir);
  reopened.close();
  assert.equal(
    (
      store.db
        .prepare("SELECT status FROM pr_reviews WHERE id=?")
        .get(id) as any
    ).status,
    "cancelled",
  );
  service.requestReview(service.monitors()[0].id, "repo", 1);
  const again = new Store(dir);
  again.close();
  assert.equal(
    (
      store.db
        .prepare("SELECT status FROM pr_reviews WHERE id=?")
        .get(id) as any
    ).status,
    "queued",
  );
});
