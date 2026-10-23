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
    azureProject: "Project One",
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
  const preparation = { status: () => ({ status: "ready" }), prepare: async (_monitor: any, _pr: any) => {} };
  const service = new PullRequests(store, agent, preparation);
  service.save({
    ...context,
    repository: "repo",
    mode: "required",
    reviewerFilter: { required: [{ id: "me", name: "Me", email: "" }], optional: [] },
    enabled: true,
  });
  return { store, service, calls, agent, dir, preparation };
}
function mock(t: any, items: any[], extra?: (url: URL, init: any) => any) {
  t.mock.method(globalThis, "fetch", async (raw: any, init: any) => {
    const url = new URL(String(raw));
    assert.equal(url.origin, "https://ado.test");
    assert.equal(
      init.headers.Authorization,
      `Basic ${Buffer.from(":test-pat").toString("base64")}`,
    );
    let data: any = extra?.(url, init);
    if (data instanceof Response) return data;
    if (data === undefined) {
      if (url.pathname.endsWith("connectionData"))
        data = { authenticatedUser: { id: "me" } };
      else if (/\/pullrequests\/\d+\/workitems$/i.test(url.pathname))
        data = { value: [] };
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
        .prepare("SELECT count(*) n FROM pr_reviews WHERE status IN ('preparing_git','queued')")
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
  store.db.prepare("UPDATE pr_reviews SET status='queued' WHERE id=?").run(id);
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
  const retryId = service.requestReview(service.monitors()[0].id, "repo", 1);
  assert.notEqual(retryId, id);
  const again = new Store(dir);
  again.close();
  assert.equal(
    (
      store.db
        .prepare("SELECT status FROM pr_reviews WHERE id=?")
        .get(retryId) as any
    ).status,
    "preparing_git",
  );
});

test("PR project comes from shared settings and old connection cannot keep using another project", (t) => {
  const { store, service } = fixture(t);
  assert.equal(service.monitors()[0].azure_project, "Project One");
  store.set("settings", {
    ...store.settings(),
    azureProject: "Another Project",
  });
  service.save({
    ...context,
    repository: "another-repo",
    mode: "all",
    enabled: true,
  });
  const active = service.monitors().filter((m) => m.enabled);
  assert.equal(active.length, 1);
  assert.equal(active[0].azure_project, "Another Project");
  store.set("settings", { ...store.settings(), azureProject: "" });
  assert.throws(
    () =>
      service.save({
        ...context,
        repository: "repo",
        mode: "all",
        enabled: true,
      }),
    /Заказчики и проекты/,
  );
});

test("PR descriptions are complete, references deduplicated and valid tickets imported locally", async (t) => {
  const { store, service } = fixture(t);
  const description =
    "Text ".repeat(90) +
    " #123456 #123456 #765432 #999999 #888888 &#123; ##456 #0";
  let batches = 0;
  const item = pr();
  store.db
    .prepare("INSERT INTO ticket_local(source,id,removed) VALUES (?,?,1)")
    .run(store.source(), 888888);
  mock(t, [{ ...item, description: description.slice(0, 400) }], (url) => {
    if (/\/pullrequests\/1$/.test(url.pathname))
      return { ...item, description };
    if (url.pathname.endsWith("/workitemsbatch")) {
      batches++;
      return {
        value: [
          {
            id: 123456,
            fields: {
              "System.TeamProject": "Project One",
              "System.Title": "Fix login",
              "System.State": "Closed",
              "System.WorkItemType": "Bug",
            },
          },
          {
            id: 765432,
            fields: {
              "System.TeamProject": "Other",
              "System.Title": "Wrong project",
            },
          },
          { id: 888888, fields: { "System.TeamProject": "Project One" } },
        ],
      };
    }
  });
  await service.sync();
  let saved: any = service.list(context)[0];
  assert.equal(saved.description, description);
  assert.deepEqual(
    saved.tickets.map((t: any) => t.id),
    [123456, 765432, 999999, 888888],
  );
  assert.equal(saved.tickets[0].title, "Fix login");
  assert.equal(saved.tickets[0].state, "Closed");
  assert.equal(saved.tickets[1].unavailable, true);
  assert.equal(saved.tickets[3].removed, true);
  assert.equal(
    (store.db.prepare("SELECT count(*) n FROM tickets").get() as any).n,
    1,
  );
  assert.equal(batches, 1);
  assert.equal(saved.ticket_error, "");
  // Removing references updates the saved association without deleting tracked work.
  mock(t, [{ ...item, description: "Updated without references" }]);
  await service.sync();
  saved = service.list(context)[0];
  assert.deepEqual(saved.tickets, []);
  assert.equal(
    (store.db.prepare("SELECT count(*) n FROM tickets").get() as any).n,
    1,
  );
});

test("ticket import failure preserves PR and exposes an independent error", async (t) => {
  const { service } = fixture(t);
  mock(t, [{ ...pr(), description: "Fix #42" }], (url) =>
    url.pathname.endsWith("/workitemsbatch")
      ? new Response("Forbidden", { status: 403 })
      : undefined,
  );
  await service.sync();
  const saved: any = service.list(context)[0];
  assert.equal(saved.description, "Fix #42");
  assert.ok(saved.ticket_error);
  assert.equal(saved.tickets[0].unavailable, true);
  assert.equal(service.monitors().length, 1);
});

test("PR ticket import only reads Azure and writes the local tracker", async (t) => {
  const { store, service, calls } = fixture(t);
  const requests: { method: string; path: string; body: any }[] = [];
  mock(t, [{ ...pr(), description: "Fix #42" }], (url, init) => {
    requests.push({
      method: init.method || "GET",
      path: url.pathname,
      body: init.body ? JSON.parse(init.body) : null,
    });
    if (url.pathname.endsWith("/wit/workitemsbatch"))
      return {
        value: [
          {
            id: 42,
            fields: {
              "System.TeamProject": "Project One",
              "System.Title": "Existing Azure ticket",
              "System.State": "Active",
              "System.WorkItemType": "Bug",
            },
          },
        ],
      };
  });
  await service.sync();
  await service.sync();
  assert.deepEqual(
    requests.filter((r) => r.method !== "GET"),
    [
      {
        method: "POST",
        path: "/tfs/Collection/Project%20One/_apis/wit/workitemsbatch",
        body: { ids: [42], errorPolicy: "Omit" },
      },
    ],
  );
  const ticket = store.db
    .prepare("SELECT title,state FROM tickets WHERE source=? AND id=42")
    .get(store.source());
  assert.deepEqual(ticket, { title: "Existing Azure ticket", state: "Active" });
  assert.equal(
    calls.length,
    0,
    "Import must not invoke the agent or its mutation tools",
  );
});

test("image proxy requires a saved description reference and current connection", async (t) => {
  const { service, store } = fixture(t);
  const url =
    "https://ado.test/tfs/Collection/Project%20One/_apis/wit/attachments/12345678-1234-1234-1234-123456789abc";
  mock(t, [{ ...pr(), description: `![Screenshot](${url})` }]);
  await service.sync();
  const row: any = service.list(context)[0];
  assert.ok(row.images[0].preview.startsWith("/api/pr/image?"));
  let reads = 0;
  t.mock.method(globalThis, "fetch", async () => {
    reads++;
    return new Response(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  });
  await assert.rejects(
    service.image(row.monitor, row.repo, row.number, "https://evil.test/x"),
    /не найдено/,
  );
  assert.equal(reads, 0);
  assert.equal(
    (await service.image(row.monitor, row.repo, row.number, url)).type,
    "image/png",
  );
  assert.equal(reads, 1);
  store.set("settings", {
    ...store.settings(),
    azureUrl: "https://different.test/org",
  });
  await assert.rejects(
    service.image(row.monitor, row.repo, row.number, url),
    /URL Azure изменён/,
  );
  assert.equal(reads, 1);
});

test("sync persists creation date and list defaults to newest creation, not ID or sync time", async (t) => {
  const { service, store } = fixture(t);
  mock(t, [
    { ...pr(10), creationDate: "2026-10-01T10:00:00Z" },
    { ...pr(1), creationDate: "2026-10-19T11:00:00+01:00" },
  ]);
  await service.sync();
  let rows: any[] = service.list(context);
  assert.deepEqual(
    rows.map((p) => p.number),
    [1, 10],
  );
  assert.equal(rows[0].created_at, "2026-10-19T10:00:00.000Z");
  mock(t, [pr(1), pr(10)]);
  await service.sync();
  rows = service.list(context);
  assert.equal(rows[0].created_at, "2026-10-19T10:00:00.000Z");
  assert.equal(
    (store.db.prepare("SELECT count(*) n FROM pr_reviews").get() as any).n,
    0,
  );
});

test("sync stores and refreshes source and target branch names", async (t) => {
  const { service } = fixture(t);
  mock(t, [
    {
      ...pr(),
      sourceRefName: "refs/heads/feature/login",
      targetRefName: "refs/heads/main",
    },
  ]);
  await service.sync();
  let saved: any = service.list(context)[0];
  assert.equal(saved.source_branch, "refs/heads/feature/login");
  assert.equal(saved.target_branch, "refs/heads/main");
  mock(t, [
    {
      ...pr(),
      sourceRefName: "refs/heads/feature/login",
      targetRefName: "refs/heads/release",
    },
  ]);
  await service.sync();
  saved = service.list(context)[0];
  assert.equal(saved.target_branch, "refs/heads/release");
});

test("review clarification pauses work until all answers arrive and passes them to the next review", async (t) => {
  const { ReviewQuestions } = await import("../server/review-questions.js");
  const { store, service, agent } = fixture(t);
  mock(t, [pr()]);
  await service.sync();
  const monitor = service.monitors()[0].id;
  const review = service.requestReview(monitor, "repo", 1);
  let runs = 0;
  t.mock.method(agent, "chat", async (...args: any[]) => {
    runs++;
    if (runs === 1)
      args[3].askQuestions([
        {
          question: "Expected timeout?",
          reason: "Contract is not in the diff",
        },
        { question: "Retry allowed?", reason: "Potential duplicate writes" },
      ]);
    else {
      assert.match(args[0], /30 seconds/);
      assert.match(args[0], /No retries/);
    }
    return {
      body: "Review summary",
      requestId: "00000000-0000-0000-0000-000000000000" as const,
    };
  });
  await service.reviewNext();
  assert.equal(
    (
      store.db
        .prepare("SELECT status FROM pr_reviews WHERE id=?")
        .get(review) as any
    ).status,
    "awaiting_answers",
  );
  await service.reviewNext();
  assert.equal(runs, 1);
  const questions = new ReviewQuestions(store),
    batch = questions.list()[0];
  assert.throws(() => questions.answer(batch.id, ["30 seconds"]));
  await service.reviewNext();
  assert.equal(runs, 1);
  questions.answer(batch.id, ["30 seconds", "No retries"]);
  await service.reviewNext();
  assert.equal(runs, 2);
  assert.equal(
    (
      store.db
        .prepare("SELECT status FROM pr_reviews WHERE id=?")
        .get(review) as any
    ).status,
    "completed",
  );
});

test("view diff uses live commits and does not invoke LLM or Azure mutations", async (t) => {
  const f = fixture(t);
  mock(t, [pr()], (_url, init) => {
    assert.ok(!init.method || init.method === "GET");
    return undefined;
  });
  await f.service.sync();
  const monitor = f.service.monitors()[0];
  const result = await f.service.viewDiff(monitor.id, "repo", 1);
  assert.equal(result.head, "head");
  assert.equal(result.target, "target");
  assert.equal(result.base, "base");
  assert.ok(result.patches.length);
  assert.equal(f.calls.length, 0);
  await assert.rejects(() => f.service.viewDiff(monitor.id, "other-repo", 1));
});

test("default PR list hides records removed from the active scan while retaining direct history", async (t) => {
  const { service } = fixture(t);
  mock(t, [pr(1), pr(2)]);
  await service.sync();
  const old: any = service.list(context).find((p: any) => p.number === 1);
  // Azure's active-only scan no longer returns a completed PR.
  mock(t, [pr(2)]);
  await service.sync();
  assert.deepEqual(
    service.list(context).map((p: any) => p.number),
    [2],
  );
  assert.equal(
    service.list(context, { monitor: old.monitor, repo: old.repo, number: 1 })
      .length,
    1,
  );
});

test("manual ticket links survive sync, appear in reverse lookup and unlink without Azure writes", async (t) => {
  const { service, store } = fixture(t);
  mock(t, [pr()], (_url, init) => {
    assert.ok(!init.method || init.method === "GET");
  });
  await service.sync();
  const row: any = service.list(context)[0];
  store.db
    .prepare(
      "INSERT INTO tickets(source,id,title,state,assigned,type,url,synced_at) VALUES (?,42,'Local bug','Active','Dev','Bug','https://ado.test/42','now')",
    )
    .run(store.source());
  const key = {
    monitor: row.monitor,
    repo: row.repo,
    number: row.number,
    ticketId: 42,
    source: store.source(),
    action: "link" as const,
  };
  await service.linkTicket(key);
  await service.linkTicket(key);
  assert.equal((service.list(context)[0] as any).tickets.length, 1);
  assert.equal(service.linkedToTicket(42, store.source()).length, 1);
  await service.sync();
  assert.equal((service.list(context)[0] as any).tickets[0].manual, true);
  await assert.rejects(() =>
    service.linkTicket({ ...key, source: "different" }),
  );
  await service.linkTicket({ ...key, action: "unlink" });
  assert.equal((service.list(context)[0] as any).tickets.length, 0);
  assert.equal(service.linkedToTicket(42, store.source()).length, 0);
  assert.ok(store.db.prepare("SELECT 1 FROM tickets WHERE id=42").get());
});

test("review options persist and disable questions without fetching tickets", async (t) => {
  const { store, service, calls } = fixture(t);
  mock(t, [pr()], (url) => {
    if (url.pathname.endsWith("/workitems"))
      throw new Error("Must not load ticket context");
  });
  await service.sync();
  const monitor = service.monitors()[0].id;
  const id = service.requestReview(monitor, "repo", 1, {
    questionFrequency: "none",
    readTickets: false,
  });
  const row = store.db
    .prepare("SELECT options FROM pr_reviews WHERE id=?")
    .get(id) as any;
  assert.deepEqual(JSON.parse(row.options), {
    model: store.settings().reviewModel || store.settings().model,
    reviewerComment: "",
    questionFrequency: "none",
    readTickets: false,
    readCode: true,
    codeDepth: "below_medium",
    maxTokens: 1000000,
    memoryScopes: ["general", "client", "project", "project_review"],
  });
  await service.reviewNext();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][3].askQuestions, undefined);
  assert.equal(calls[0][3].questionFrequency, "none");
  assert.equal(calls[0][3].codeDepth, "below_medium");
});

test("review receives requirements, comments and source-scoped local notes before calling model", async (t) => {
  const { store, service, calls } = fixture(t);
  store.db.prepare("INSERT INTO ticket_metadata(source,id,notes) VALUES (?,?,?)").run(store.source(), 42, "Preserve local retry policy");
  store.db.prepare("INSERT INTO ticket_metadata(source,id,notes) VALUES (?,?,?)").run("other-source", 42, "Foreign notes must not leak");
  mock(t, [pr()], (url) => {
    if (/\/pullrequests\/1\/workitems$/i.test(url.pathname))
      return { value: [{ id: "42" }] };
    if (/\/workitems\/42$/.test(url.pathname))
      return {
        id: 42,
        fields: {
          "System.TeamProject": "Project One",
          "System.Title": "Requirements",
          "System.Description": "<p>Keep existing behaviour</p>",
          "Microsoft.VSTS.Common.AcceptanceCriteria": "<p>Allow retries</p>",
        },
      };
    if (url.pathname.endsWith("/workitems/42/comments"))
      return url.searchParams.get("continuationToken")
        ? { comments: [{ id: 2, text: "Second comment" }] }
        : {
            comments: [{ id: 1, text: "First comment" }],
            continuationToken: "next",
          };
  });
  await service.sync();
  service.requestReview(service.monitors()[0].id, "repo", 1);
  await service.reviewNext();
  assert.equal(calls.length, 1);
  assert.match(calls[0][0], /Keep existing behaviour/);
  assert.match(calls[0][0], /Allow retries/);
  assert.match(calls[0][0], /First comment/);
  assert.match(calls[0][0], /Second comment/);
  assert.match(calls[0][0], /"localNotes":"Preserve local retry policy"/);
  assert.doesNotMatch(calls[0][0], /Foreign notes must not leak/);
  assert.equal(calls[0][3].questionFrequency, "medium");
  assert.throws(() =>
    calls[0][3].askQuestions(Array(4).fill({ question: "?", reason: "risk" })),
  );
});

test("missing ticket comments stop review before spending model tokens", async (t) => {
  const { store, service, calls } = fixture(t);
  mock(t, [pr()], (url) => {
    if (/\/pullrequests\/1\/workitems$/i.test(url.pathname))
      return { value: [{ id: "42" }] };
    if (/\/workitems\/42$/.test(url.pathname))
      return { id: 42, fields: { "System.TeamProject": "Project One" } };
    if (url.pathname.endsWith("/workitems/42/comments"))
      return new Response("Forbidden", { status: 403 });
  });
  await service.sync();
  const id = service.requestReview(service.monitors()[0].id, "repo", 1);
  await service.reviewNext();
  assert.equal(calls.length, 0);
  const row = store.db
    .prepare("SELECT status,error FROM pr_reviews WHERE id=?")
    .get(id) as any;
  assert.equal(row.status, "error");
  assert.match(row.error, /Комментарии/);
});

test("ignoring questions completes review and explicit rerun preserves history", async (t) => {
  const { ReviewQuestions } = await import("../server/review-questions.js");
  const { store, service, calls } = fixture(t);
  mock(t, [pr()]);
  await service.sync();
  const monitor = service.monitors()[0].id;
  const first = service.requestReview(monitor, "repo", 1, {
    readTickets: false,
  });
  store.db
    .prepare(
      "UPDATE pr_reviews SET status='awaiting_answers',summary='Original report' WHERE id=?",
    )
    .run(first);
  const questions = new ReviewQuestions(store);
  questions.create(first, [
    { question: "Expected behaviour?", reason: "Risk" },
  ]);
  const batch = questions.list()[0];
  questions.dismiss(batch.id);
  const saved = store.db
    .prepare("SELECT * FROM pr_reviews WHERE id=?")
    .get(first) as any;
  assert.equal(saved.status, "completed");
  assert.match(saved.summary, /Original report/);
  assert.match(saved.summary, /без ответов/);
  assert.equal(calls.length, 0);
  assert.throws(() => questions.answer(batch.id, ["Yes"]));
  assert.equal(service.requestReview(monitor, "repo", 1), first);
  const second = service.requestReview(
    monitor,
    "repo",
    1,
    { readTickets: false, reviewerComment: "Focus on retries" },
    true,
  );
  assert.notEqual(second, first);
  assert.equal(service.requestReview(monitor, "repo", 1, {}, true), second);
  assert.equal(
    (store.db.prepare("SELECT count(*) n FROM pr_reviews").get() as any).n,
    2,
  );
  assert.equal(service.list(context)[0].review_id, second);
  await service.reviewNext();
  assert.equal(calls.length, 1);
  assert.match(calls[0][0], /Focus on retries/);
  assert.equal(questions.history(second).length, 0);
});

test("PR commit history paginates read-only and rejects unknown PRs", async (t) => {
  const { service, calls } = fixture(t);
  const cursors: string[] = [];
  mock(t, [pr()], (url, init) => {
    assert.ok(!init.method || init.method === "GET");
    if (
      url.pathname.endsWith("/commits") &&
      url.pathname.includes("/pullRequests/")
    ) {
      cursors.push(url.searchParams.get("continuationToken") || "");
      assert.equal(url.searchParams.get("$top"), "50");
      return new Response(
        JSON.stringify({
          value: [
            {
              commitId: cursors.length === 1 ? "abc123" : "def456",
              comment: `Fix error
More detail`,
              author: { name: "Developer", date: "2026-10-20T10:00:00Z" },
            },
          ],
        }),
        {
          headers: {
            "Content-Type": "application/json",
            ...(cursors.length === 1
              ? { "x-ms-continuationtoken": "next/page+" }
              : {}),
          },
        },
      );
    }
  });
  await service.sync();
  const monitor = service.monitors()[0].id;
  const first = await service.commits(monitor, "repo", 1);
  assert.equal(first.commits[0].author, "Developer");
  assert.equal(first.continuationToken, "next/page+");
  const next = await service.commits(
    monitor,
    "repo",
    1,
    first.continuationToken,
  );
  assert.equal(next.continuationToken, "");
  assert.deepEqual(cursors, ["", "next/page+"]);
  await assert.rejects(service.commits(monitor, "repo", 999), /PR не найден/);
  assert.equal(calls.length, 0);
});

test("commit diff uses first parent, checks PR membership and never invokes model", async (t) => {
  const { service, calls } = fixture(t);
  const head = "a".repeat(40),
    parent = "b".repeat(40);
  mock(t, [pr()], (url, init) => {
    assert.ok(!init.method || init.method === "GET");
    if (url.pathname.endsWith("/pullRequests/1/commits"))
      return { value: [{ commitId: head, comment: "Fix" }] };
    if (url.pathname.endsWith("/commits/" + head))
      return {
        commitId: head,
        parents: [parent, "c".repeat(40)],
        comment: "Merge fix",
      };
    if (url.pathname.endsWith("/diffs/commits")) {
      assert.equal(url.searchParams.get("baseVersion"), parent);
      assert.equal(url.searchParams.get("targetVersion"), head);
      return { commonCommit: parent, allChangesIncluded: true, changes: [] };
    }
  });
  await service.sync();
  const monitor = service.monitors()[0].id;
  const page = await service.commits(monitor, "repo", 1);
  assert.equal(
    page.commits[0].url,
    "https://ado.test/tfs/Collection/Project%20One/_git/repo/commit/" + head,
  );
  const diff = await service.commitDiff(monitor, "repo", 1, head);
  assert.equal(diff.base, parent);
  assert.match(diff.notes.join(" "), /первым родителем/);
  await assert.rejects(
    service.commitDiff(monitor, "repo", 1, "d".repeat(40)),
    /не найден/,
  );
  await assert.rejects(service.commitDiff(monitor, "repo", 1, "../bad"), /SHA/);
  assert.equal(calls.length, 0);
});

test("project exclusions precede file reads and file cap in review and View Diff", async (t) => {
  const { service } = fixture(t);
  const reads: string[] = [];
  mock(t, [pr()], (url) => {
    if (url.pathname.endsWith("/diffs/commits"))
      return {
        commonCommit: "base",
        allChangesIncluded: true,
        changes: [
          { changeType: "add", item: { path: "/src/api/generatedApi.ts" } },
          ...Array.from({ length: 100 }, (_, i) => ({
            changeType: "add",
            item: { path: "/generated/" + i + ".ts" },
          })),
          { changeType: "add", item: { path: "/src/app.ts" } },
        ],
      };
    if (url.pathname.endsWith("/items")) {
      reads.push(url.searchParams.get("path")!);
      return { content: "export const value = 1;" };
    }
  });
  service.save({
    ...context,
    repository: "repo",
    mode: "required",
    enabled: true,
    reviewFiles: {
      ignoredPaths: ["generated/", "/src/api/generatedApi.ts"],
      diffBudget: 160000,
    },
  });
  const m = service.monitors()[0];
  const review = await service.changes(m, "repo", "head", "target");
  assert.deepEqual(reads, ["/src/app.ts"]);
  assert.equal(review.patches.length, 1);
  assert.match(review.notes.join(" "), /Исключено.*101/);
  await service.sync();
  reads.length = 0;
  const viewed = await service.viewDiff(m.id, "repo", 1);
  assert.deepEqual(reads, ["/src/app.ts"]);
  assert.equal(viewed.limits.totalCharacters, 160000);
  assert.equal(viewed.limits.ignoredFiles, 101);
  assert.equal(
    viewed.limits.usedCharacters,
    viewed.patches.reduce((n: number, patch: string) => n + patch.length, 0),
  );
  assert.equal(viewed.limits.usedCharacters, review.limits.usedCharacters);
  assert.deepEqual(
    viewed.diagnostics.includedFiles.map((f) => f.path),
    ["/src/app.ts"],
  );
  assert.ok(
    viewed.diagnostics.excludedPaths.includes("/src/api/generatedApi.ts"),
  );
  assert.deepEqual(viewed.diagnostics.unmatchedRules, []);
});
test("a large patch cannot consume the review budget reserved for other files", async (t) => {
  const { service } = fixture(t);
  mock(t, [pr()], (url) => {
    if (url.pathname.endsWith("/diffs/commits"))
      return {
        commonCommit: "base",
        allChangesIncluded: true,
        changes: [
          { changeType: "add", item: { path: "/big.ts" } },
          { changeType: "add", item: { path: "/small.ts" } },
        ],
      };
    if (url.pathname.endsWith("/items"))
      return {
        content:
          url.searchParams.get("path") === "/big.ts"
            ? "x".repeat(12000)
            : "small",
      };
  });
  service.save({
    ...context,
    repository: "repo",
    mode: "required",
    enabled: true,
    reviewFiles: { ignoredPaths: [], diffBudget: 40000 },
  });
  const result = await service.changes(
    service.monitors()[0],
    "repo",
    "head",
    "target",
  );
  assert.equal(result.patches.length, 1);
  assert.match(result.patches[0], /small.ts/);
  assert.match(result.notes.join(" "), /лимит одного файла 10000/);
});

test("PR cards retain Azure links after removing local links and include title references", async (t) => {
  const { service, store } = fixture(t);
  mock(t, [{ ...pr(), title: "Fix #42", description: "Details #43" }], (url) =>
    /\/pullrequests\/1\/workitems$/i.test(url.pathname)
      ? { value: [{ id: "44" }] }
      : undefined,
  );
  await service.sync();
  const monitor = service.monitors()[0].id;
  store.db
    .prepare(
      "INSERT INTO pr_ticket_links(monitor,repo,number,ticket_id) VALUES (?, 'repo',1,44)",
    )
    .run(monitor);
  store.db.prepare("DELETE FROM pr_ticket_links WHERE monitor=?").run(monitor);
  const row = service.list(context)[0];
  assert.deepEqual(row.tickets.map((v: any) => v.id).sort(), [42, 43, 44]);
  assert.equal(row.tickets.find((v: any) => v.id === 44).fromAzure, true);
  assert.equal(row.tickets.find((v: any) => v.id === 44).manual, false);
  assert.equal(row.tickets.find((v: any) => v.id === 42).fromTitle, true);
});

test("completed PR pages are bounded, refreshed and coalesce concurrent requests", async (t) => {
  const { service } = fixture(t);
  let requests = 0;
  mock(t, [], (url) => {
    if (url.pathname.endsWith("/workitems")) return { value: [] };
    const detail = url.pathname.match(/\/pullrequests\/(\d+)$/);
    if (detail) return { ...pr(Number(detail[1])), status: "completed", description: "Full archived description" };
    if (url.searchParams.get("searchCriteria.status") !== "completed")
      throw new Error("Unexpected request");
    requests++;
    assert.equal(url.searchParams.get("$top"), "21");
    const offset = Number(url.searchParams.get("$skip"));
    return {
      value: Array.from({ length: 21 }, (_, i) => ({
        ...pr(offset + i + 1),
        status: "completed",
        closedDate: new Date().toISOString(),
        description: "Full archived description",
      })),
    };
  });
  const monitor = service.monitors()[0].id;
  const [first, duplicate] = await Promise.all([
    service.completed(monitor, 0),
    service.completed(monitor, 0),
  ]);
  assert.equal(requests, 1);
  assert.deepEqual(first, duplicate);
  assert.equal(first.items.length, 20);
  assert.equal(first.hasNext, true);
  await service.completed(monitor, 0);
  assert.equal(requests, 2);
  const next = await service.completed(monitor, 1);
  assert.equal(requests, 3);
  assert.equal(next.items[0].number, 21);
  assert.equal(first.items[0].description, "Full archived description");
  assert.equal(first.items[0].in_scope, 0);
  service.purgeCompleted(Date.now() + 31 * 86400000);
  assert.equal(
    service.list(context, { monitor, repo: "repo", number: 1 }).length,
    0,
  );
});


test("review model override survives settings changes and is recorded in results", async (t) => {
  const { store, service, calls } = fixture(t);
  mock(t, [pr()]);
  await service.sync();
  const monitor = service.monitors()[0].id;
  const id = service.requestReview(monitor, "repo", 1, {
    model: "review-override",
    readTickets: false,
    questionFrequency: "none",
  });
  store.set("settings", { ...store.settings(), reviewModel: "changed-default" });
  await service.reviewNext();
  assert.equal(calls[0][5], "review-override");
  assert.equal((store.db.prepare("SELECT model FROM pr_reviews WHERE id=?").get(id) as any).model, "review-override");
  assert.equal((service.list(context)[0] as any).model, "review-override");
});

test("review resolves its default model when queued", async (t) => {
  const { store, service, calls } = fixture(t);
  store.set("settings", { ...store.settings(), reviewModel: "initial-default" });
  mock(t, [pr()]);
  await service.sync();
  service.requestReview(service.monitors()[0].id, "repo", 1, { readTickets: false, questionFrequency: "none" });
  store.set("settings", { ...store.settings(), reviewModel: "changed-default" });
  await service.reviewNext();
  assert.equal(calls[0][5], "initial-default");
});

test("review waits for source preparation and never invokes the model after Git failure", async t => {
  const { store, service, calls, preparation } = fixture(t);
  mock(t, [pr()]);
  await service.sync();
  let finish!: () => void;
  const ready = new Promise<void>(resolve => { finish = resolve; });
  preparation.prepare = async () => { await ready; };
  const id = service.requestReview(service.monitors()[0].id, "repo", 1);
  assert.equal((store.db.prepare("SELECT status FROM pr_reviews WHERE id=?").get(id) as any).status, "preparing_git");
  const running = service.reviewNext();
  assert.equal(calls.length, 0);
  finish(); await running;
  assert.equal(calls.length, 1);
  preparation.prepare = async () => { throw new Error("Git unavailable"); };
  service.requestReview(service.monitors()[0].id, "repo", 1, {}, true);
  await service.reviewNext();
  assert.equal(calls.length, 1);
  assert.equal((service.list(context)[0] as any).review_status, "error");
});

test("review without code access skips Git preparation and waits only for the model", async t => {
  const { store, service, calls, preparation, agent } = fixture(t);
  mock(t, [pr()]);
  await service.sync();
  let preparations = 0;
  preparation.prepare = async () => { preparations++; throw new Error("Git unavailable"); };
  const id = service.requestReview(service.monitors()[0].id, "repo", 1, {
    readCode: false, readTickets: false, questionFrequency: "none",
  });
  const status = () => (store.db.prepare("SELECT status FROM pr_reviews WHERE id=?").get(id) as any).status;
  assert.equal(status(), "queued");
  const busy = t.mock.method(agent, "active", () => "busy" as any);
  await service.reviewNext();
  assert.equal(status(), "queued");
  assert.equal(preparations, 0);
  assert.equal(calls.length, 0);
  busy.mock.restore();
  await service.reviewNext();
  assert.equal(preparations, 0);
  assert.equal(calls.length, 1);
  assert.equal(status(), "completed");
});

test("diff reports full file byte size rather than patch length", async t => {
  const { service } = fixture(t);
  mock(t, [pr()], url => url.pathname.endsWith("/items") ? {
    content: url.searchParams.get("versionDescriptor.version") === "base" ? "old" : "Привет", contentMetadata: { isBinary: false },
  } : undefined);
  const diff = await service.changes(service.monitors()[0], "repo", "head", "target");
  assert.equal(diff.diagnostics.includedFiles[0].sizeBytes, Buffer.byteLength("Привет", "utf8"));
});

test("stop review removes queued work without cancelling an unrelated chat", async t => {
  const { store, service, agent, calls } = fixture(t);
  mock(t, [pr()]); await service.sync();
  let stops = 0; Object.assign(agent, { stop: () => { stops++; } });
  const id = service.requestReview(service.monitors()[0].id, "repo", 1, { readCode: false });
  assert.deepEqual(service.stopReview(id), { stopped: true });
  await service.reviewNext();
  assert.equal(calls.length, 0); assert.equal(stops, 0);
  assert.equal((store.db.prepare("SELECT status FROM pr_reviews WHERE id=?").get(id) as any).status, "interrupted");
});

test("stop review during source preparation cannot start the model afterwards", async t => {
  const { store, service, calls, preparation } = fixture(t);
  mock(t, [pr()]); await service.sync();
  let entered!: () => void, finish!: () => void;
  const started = new Promise<void>(r => { entered = r; });
  const ready = new Promise<void>(r => { finish = r; });
  preparation.prepare = async () => { entered(); await ready; };
  const id = service.requestReview(service.monitors()[0].id, "repo", 1);
  const running = service.reviewNext(); await started;
  service.stopReview(id); finish(); await running;
  assert.equal(calls.length, 0);
  assert.equal((store.db.prepare("SELECT status FROM pr_reviews WHERE id=?").get(id) as any).status, "interrupted");
  assert.notEqual(service.requestReview(service.monitors()[0].id, "repo", 1), id);
});

test("stop review cancels its model and does not save a late completion", async t => {
  const { store, service, agent } = fixture(t);
  mock(t, [pr()]); await service.sync();
  let entered!: () => void, finish!: () => void, stops = 0;
  const started = new Promise<void>(r => { entered = r; });
  const ready = new Promise<void>(r => { finish = r; });
  agent.chat = async () => { entered(); await ready; return { body: "late", requestId: "00000000-0000-0000-0000-000000000000" }; };
  Object.assign(agent, { stop: () => { stops++; finish(); } });
  const id = service.requestReview(service.monitors()[0].id, "repo", 1, { readCode: false, readTickets: false });
  const running = service.reviewNext(); await started;
  service.stopReview(id); await running;
  assert.equal(stops, 1);
  const row = store.db.prepare("SELECT status,summary FROM pr_reviews WHERE id=?").get(id) as any;
  assert.equal(row.status, "interrupted"); assert.equal(row.summary, null);
  assert.deepEqual(service.stopReview(id), { stopped: false });
});

for (const codeDepth of ["low", "below_medium", "medium", "high"] as const) {
  test(`review preserves and passes ${codeDepth} exploration depth`, async t => {
    const { store, service, calls } = fixture(t);
    mock(t, [pr()]); await service.sync();
    const id = service.requestReview(service.monitors()[0].id, "repo", 1, { codeDepth, readTickets: false });
    const row = store.db.prepare("SELECT options FROM pr_reviews WHERE id=?").get(id) as any;
    assert.equal(JSON.parse(row.options).codeDepth, codeDepth);
    await service.reviewNext();
    assert.equal(calls[0][3].codeDepth, codeDepth);
  });
}

for (const action of ["abandon", "draft", "publish"] as const) {
  test(`PR ${action} writes only its state and resynchronizes afterwards`, async t => {
    const { store, service } = fixture(t);
    const item = { ...pr(), isDraft: action === "publish" };
    const items = [item]; let writes = 0, readsAfterWrite = 0;
    mock(t, items, (url, init) => {
      if (init.method === "PATCH") {
        writes++;
        assert.deepEqual(JSON.parse(init.body), action === "abandon" ? { status: "abandoned" } : { isDraft: action === "draft" });
        if (action === "abandon") { item.status = "abandoned"; items.splice(0); }
        else item.isDraft = action === "draft";
        return item;
      }
      if (writes && url.pathname.endsWith("/pullrequests")) readsAfterWrite++;
    });
    await service.sync();
    const monitor = service.monitors()[0].id;
    const result = await service.changeState(monitor, "repo", 1, action);
    assert.equal(result.updated, true); assert.equal(writes, 1); assert.ok(readsAfterWrite);
    const saved = store.db.prepare("SELECT draft,in_scope FROM pull_requests WHERE monitor=? AND repo='repo' AND number=1").get(monitor) as any;
    if (action === "abandon") assert.equal(saved.in_scope, 0);
    else assert.equal(saved.draft, Number(action === "draft"));
  });
}

test("PR state changes reject closed PRs without writes and preserve state on denied PATCH", async t => {
  const { store, service } = fixture(t);
  const item = pr(); let writes = 0;
  mock(t, [item], (_url, init) => {
    if (init.method === "PATCH") { writes++; return Response.json({ message: "Denied" }, { status: 403 }); }
  });
  await service.sync(); const monitor = service.monitors()[0].id;
  item.status = "completed";
  await assert.rejects(service.changeState(monitor, "repo", 1, "draft"), /уже закрыт/);
  assert.equal(writes, 0);
  item.status = "active";
  await assert.rejects(service.changeState(monitor, "repo", 1, "draft"), /403/);
  assert.equal(writes, 1);
  assert.equal((store.db.prepare("SELECT draft FROM pull_requests WHERE monitor=?").get(monitor) as any).draft, 0);
});

for (const selected of [[42], [], [99]]) {
  test(`review reads only explicitly selected linked tickets: ${JSON.stringify(selected)}`, async t => {
    const { store, service, calls } = fixture(t);
    const reads: number[] = [];
    let linkReads = 0;
    mock(t, [pr()], url => {
      if (/\/pullrequests\/1\/workitems$/i.test(url.pathname)) {
        linkReads++;
        return { value: [{ id: "42" }, { id: "43" }] };
      }
      const ticket = url.pathname.match(/\/workitems\/(\d+)$/);
      if (ticket) {
        const id = Number(ticket[1]);
        reads.push(id);
        assert.equal(id, 42, "Unselected tickets must never be fetched");
        return { id, fields: { "System.TeamProject": "Project One", "System.Title": "Selected requirement", "System.Description": "Only selected content" } };
      }
      if (url.pathname.endsWith("/workitems/42/comments")) return { comments: [] };
    });
    await service.sync();
    linkReads = 0;
    const review = service.requestReview(service.monitors()[0].id, "repo", 1, { readCode: false, readTickets: true, ticketIds: selected });
    const saved = store.db.prepare("SELECT options FROM pr_reviews WHERE id=?").get(review) as any;
    assert.deepEqual(JSON.parse(saved.options).ticketIds, selected);
    await service.reviewNext();
    if (selected.includes(99)) {
      assert.equal(calls.length, 0);
      assert.deepEqual(reads, []);
      const result = store.db.prepare("SELECT error FROM pr_reviews WHERE id=?").get(review) as any;
      assert.match(result.error, /Связи тикетов PR изменились/);
    } else {
      assert.equal(calls.length, 1);
      assert.deepEqual(reads, selected);
      assert.deepEqual(calls[0][3].ticketEvidence?.tickets.map((ticket: any) => ticket.id) || [], selected);
      if (!selected.length) assert.equal(linkReads, 0);
      else assert.match(calls[0][0], /Only selected content/);
    }
  });
}

test("PR sync encodes collection, project and repository spaces exactly once", async t => {
  const { store, service } = fixture(t);
  for (const collection of ["My Collection", "My%20Collection"]) {
    store.set("settings", { ...store.rawSettings(), azureUrl: `https://ado.test/tfs/${collection}`, azureProject: "Project One" });
    service.save({ ...context, repository: " Repo Name ", mode: "all", enabled: true });
    const urls: string[] = [];
    t.mock.method(globalThis, "fetch", async (raw: any) => {
      urls.push(String(raw));
      const url = new URL(String(raw));
      assert.equal(url.pathname, "/tfs/My%20Collection/Project%20One/_apis/git/repositories/Repo%20Name/pullrequests");
      assert.equal(url.searchParams.get("searchCriteria.status"), "active");
      assert.equal(url.searchParams.get("$top"), "100");
      assert.equal(url.searchParams.get("$skip"), "0");
      assert.equal(url.searchParams.get("api-version"), "7.1");
      assert.ok(!String(raw).includes("%2520"));
      return Response.json({ value: [] });
    });
    await service.sync();
    assert.equal(urls.length, 1);
    assert.equal(service.monitors().find(m => m.enabled)?.error, null);
    t.mock.restoreAll();
  }
});

test("missing PR repository is rejected before Azure requests", async t => {
  const { store, service } = fixture(t);
  store.db.prepare("UPDATE pr_projects SET repository='   '").run();
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => { requests++; return Response.json({}); });
  await service.sync();
  assert.equal(requests, 0);
  assert.match(service.monitors()[0].error || "", /Заказчики и проекты.*Репозиторий/);
});

test("explicit-reviewer sync skips connectionData and uses stable Git API", async t => {
  const { service } = fixture(t);
  const paths: string[] = [];
  t.mock.method(globalThis, "fetch", async (raw: any) => {
    const url = new URL(String(raw));
    paths.push(url.pathname);
    assert.ok(!url.pathname.endsWith("connectionData"));
    assert.equal(url.searchParams.get("api-version"), "7.1");
    return Response.json({ value: [] });
  });
  await service.sync();
  assert.equal(paths.length, 1);
  assert.equal(service.monitors()[0].error, null);
});

test("PR sync errors identify endpoint and sanitized Azure reason", async t => {
  const { service } = fixture(t);
  t.mock.method(globalThis, "fetch", async () => Response.json({ message: "Use a preview API version. test-pat" }, { status: 400 }));
  await service.sync();
  const error = service.monitors()[0].error || "";
  assert.match(error, /git\/repositories\/repo\/pullrequests/);
  assert.match(error, /Use a preview API version/);
  assert.match(error, /HTTP 400/);
  assert.ok(!error.includes("test-pat"));
});

test("explicit reviewer filters OR across required/optional, persist and replace membership", async t => {
  const { store, service } = fixture(t);
  const person = (id: string) => ({ id, name: id, email: "" });
  const input = { ...context, repository: "repo", mode: "required" as const, enabled: true,
    reviewerFilter: { required: [person("alice"), person("bob")], optional: [person("carol")] } };
  service.save(input);
  const items = [
    { ...pr(1), reviewers: [{ id: "ALICE", isRequired: true }] },
    { ...pr(2), reviewers: [{ id: "bob", isRequired: true }] },
    { ...pr(3), reviewers: [{ id: "carol", isRequired: false }] },
    { ...pr(4), reviewers: [{ id: "alice", isRequired: false }] },
    { ...pr(5), reviewers: [{ id: "carol", isRequired: true }] },
    { ...pr(6), reviewers: [{ id: "alice", isRequired: true, isContainer: true }] },
    pr(7),
  ];
  mock(t, items, url => { if (url.pathname.endsWith("connectionData")) throw new Error("Explicit IDs must not request PAT identity"); });
  await service.sync();
  assert.equal(service.monitors()[0].error, null);
  assert.deepEqual(service.list(context).map(p => p.number).sort(), [1, 2, 3]);
  assert.deepEqual(JSON.parse(service.monitors()[0].reviewer_filter!), input.reviewerFilter);
  service.save({ ...input, reviewerFilter: { required: [], optional: [] } });
  await service.sync();
  assert.equal(service.list(context).length, 0);
  service.save({ ...input, mode: "all" });
  await service.sync();
  assert.equal(service.list(context).length, 7);
  assert.equal((store.db.prepare("SELECT count(*) AS n FROM pull_requests").get() as any).n, 7);
});

test("a short list description cut inside six-digit ID is resolved against full PR", async t => {
  const { service } = fixture(t);
  const full = { ...pr(), title: "Fix", description: "See #123456" };
  mock(t, [{ ...full, description: "See #12345" }], url => {
    if (/\/pullrequests\/1$/.test(url.pathname)) return full;
    if (url.pathname.endsWith("/workitemsbatch")) return { value: [] };
  });
  await service.sync();
  assert.equal(service.monitors()[0].error, null);
  assert.deepEqual((service.list(context)[0] as any).tickets.map((t: any) => t.id), [123456]);
});

test("local exclusion overrides Azure/title/description, survives sync and can be restored", async t => {
  const { service, store } = fixture(t);
  mock(t, [{ ...pr(), title: "Fix #123456", description: "Requirement #123456" }], (url, init) => {
    assert.notEqual(init.method, "PATCH");
    if (url.pathname.endsWith("/workitems")) return { value: [{ id: "123456" }] };
    if (url.pathname.endsWith("/workitemsbatch")) return { value: [] };
  });
  await service.sync();
  const row: any = service.list(context)[0];
  const key = { monitor: row.monitor, repo: row.repo, number: row.number, ticketId: 123456, source: store.source() };
  await service.linkTicket({ ...key, action: "disable" });
  await service.sync();
  const ticket = (service.list(context)[0] as any).tickets[0];
  assert.equal(ticket.disabled, true);
  assert.equal(ticket.fromAzure, true);
  assert.equal(ticket.fromTitle, true);
  assert.equal(ticket.fromDescription, true);
  assert.equal(service.linkedToTicket(123456, store.source()).length, 0);
  await service.linkTicket({ ...key, action: "enable" });
  assert.equal((service.list(context)[0] as any).tickets[0].disabled, false);
  assert.equal(service.linkedToTicket(123456, store.source()).length, 1);
});

test("review skips disabled ticket even when selected before disabling", async t => {
  const { store, service, calls } = fixture(t);
  mock(t, [pr()], url => {
    if (/\/pullrequests\/1\/workitems$/i.test(url.pathname)) return { value: [{ id: "42" }] };
    if (/\/workitems\/42/.test(url.pathname)) throw Error("Disabled ticket must not be read");
    if (url.pathname.endsWith("/workitemsbatch")) return { value: [] };
  });
  await service.sync();
  const monitor = service.monitors()[0].id;
  service.requestReview(monitor, "repo", 1, { readCode: false, readTickets: true, ticketIds: [42] });
  await service.linkTicket({ monitor, repo: "repo", number: 1, ticketId: 42, source: store.source(), action: "disable" });
  await service.reviewNext();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][3].ticketEvidence?.tickets || [], []);
});


test("completed PR history caches descriptions and links for a week", async t => {
  const { service, store } = fixture(t);
  let revision = 0;
  const bodies = ["Short description #123456", "Updated #987654"];
  mock(t, [], url => {
    if (url.pathname.endsWith("/workitems")) return { value: [{ id: revision ? "555555" : "444444" }] };
    const item = { ...pr(), status: "completed", closedDate: new Date().toISOString(), title: "Revision " + revision, description: bodies[revision] };
    if (/\/pullrequests\/1$/.test(url.pathname)) assert.fail("Completed history must not fetch PR details");
    if (url.searchParams.get("searchCriteria.status") === "completed") return { value: [{ ...item, description: bodies[revision].slice(0, 400) }] };
  });
  const monitor = service.monitors()[0].id;
  const first = await service.completed(monitor, 0);
  assert.equal(first.items[0].description, bodies[0]);
  assert.deepEqual(first.items[0].tickets.map((t: { id: number }) => t.id).sort(), [123456, 444444]);
  store.db.prepare("INSERT INTO pr_ticket_exclusions VALUES (?,?,?,?)").run(monitor, "repo", 1, 555555);
  revision = 1;
  const next = await service.completed(monitor, 0);
  assert.equal(next.items[0].title, "Revision 0");
  assert.equal(next.items[0].description, bodies[0]);
  assert.deepEqual(next.items[0].tickets.map((t: { id: number }) => t.id).sort(), [123456, 444444, 555555]);
  assert.equal(next.items[0].tickets.find((t: { id: number }) => t.id === 555555)?.disabled, true);
});


test("active import always reads full PR before parsing even a short innocent-looking list description", async t => {
  const { service } = fixture(t);
  let details = 0;
  const description = "Context ".repeat(100) + "#123456 and #765432";
  mock(t, [{ ...pr(), title: "Short title", description: "Short summary without a trailing reference." }], url => {
    if (/\/pullrequests\/1$/.test(url.pathname)) {
      details++;
      return { ...pr(), title: "Full title #987654", description };
    }
    if (url.pathname.endsWith("/workitemsbatch")) return { value: [] };
  });
  await service.sync();
  assert.equal(details, 1);
  const row = service.list(context)[0];
  assert.equal(row.description, description);
  assert.equal(row.title, "Full title #987654");
  assert.deepEqual(row.tickets.map((ticket: { id: number }) => ticket.id).sort(), [123456, 765432, 987654]);
});


test("completed cache preserves imported full description and local links until seven days after closure", async t => {
  const { service, store, agent, preparation } = fixture(t);
  const full = "Full context ".repeat(100) + " #123456";
  let completed = false, linkReads = 0;
  const closed = new Date().toISOString();
  mock(t, [{ ...pr(), description: "Short" }], url => {
    if (url.searchParams.get("searchCriteria.status") === "completed")
      return { value: [{ ...pr(), status: "completed", closedDate: closed, description: "Short" }] };
    if (/\/pullrequests\/1$/.test(url.pathname)) {
      assert.equal(completed, false, "Completed history must not request full details");
      return { ...pr(), description: full };
    }
    if (url.pathname.endsWith("/workitems")) { linkReads++; return { value: [] }; }
    if (url.pathname.endsWith("/workitemsbatch")) return { value: [] };
  });
  await service.sync();
  const monitor = service.monitors()[0].id;
  store.db.prepare("INSERT INTO pr_ticket_links(monitor,repo,number,ticket_id) VALUES (?,?,?,?)").run(monitor, "repo", 1, 654321);
  completed = true;
  const first = await service.completed(monitor, 0);
  assert.equal(first.items[0].description, full);
  assert.ok(first.items[0].tickets.some((ticket: { id: number }) => ticket.id === 654321));
  const reads = linkReads;
  const restarted = new PullRequests(store, agent, preparation);
  assert.equal((await restarted.completed(monitor, 0)).items[0].description, full);
  assert.equal(linkReads, reads, "Persisted cache must avoid repeated Azure link requests");
  restarted.purgeCompleted(Date.parse(closed) + 6 * 86400000);
  assert.equal(restarted.list(context, { monitor, repo: "repo", number: 1 }).length, 1);
  restarted.purgeCompleted(Date.parse(closed) + 7 * 86400000 + 1);
  assert.equal(restarted.list(context, { monitor, repo: "repo", number: 1 }).length, 0);
  assert.equal((store.db.prepare("SELECT count(*) AS n FROM pr_ticket_links WHERE monitor=?").get(monitor) as { n: number }).n, 0);
});

test("completed reimport replaces full content and resets local links only after successful loading", async t => {
  const { service, store } = fixture(t);
  const closed = new Date().toISOString();
  let reimport = false, failLinks = false;
  const full = "Complete server description ".repeat(50) + "#222222";
  mock(t, [], url => {
    if (url.searchParams.get("searchCriteria.status") === "completed")
      return { value: [{ ...pr(), status: "completed", closedDate: closed, description: "Old #111111" }] };
    if (/\/pullrequests\/1$/.test(url.pathname))
      return { ...pr(), status: "completed", closedDate: closed, title: "Fresh title", description: full };
    if (url.pathname.endsWith("/workitems"))
      return failLinks ? {} : { value: [{ id: reimport ? "333333" : "444444" }] };
  });
  const monitor = service.monitors()[0].id;
  await service.completed(monitor, 0);
  store.db.prepare("INSERT INTO pr_ticket_links VALUES (?,?,?,?)").run(monitor, "repo", 1, 555555);
  store.db.prepare("INSERT INTO pr_ticket_exclusions VALUES (?,?,?,?)").run(monitor, "repo", 1, 333333);
  reimport = true;
  failLinks = true;
  await assert.rejects(service.reimportCompleted(monitor, "repo", 1), /Локальный кэш сохранён/);
  const unchanged = service.list(context, { monitor, repo: "repo", number: 1 })[0];
  assert.equal(unchanged.description, "Old #111111");
  assert.ok(unchanged.tickets.some((ticket: any) => ticket.id === 555555 && ticket.manual));
  assert.ok(unchanged.tickets.some((ticket: any) => ticket.id === 333333 && ticket.disabled));
  failLinks = false;
  const updated = await service.reimportCompleted(monitor, "repo", 1);
  assert.equal(updated.title, "Fresh title");
  assert.equal(updated.description, full);
  assert.deepEqual(updated.tickets.map((ticket: any) => ticket.id).sort(), [222222, 333333]);
  assert.ok(updated.tickets.every((ticket: any) => !ticket.disabled && !ticket.manual));
  assert.equal(Date.parse(updated.expiresAt), Date.parse(closed) + 7 * 86400000);
  assert.equal((await service.completed(monitor, 0)).items[0].description, full);
  await assert.rejects(service.reimportCompleted(monitor, "repo", 2), /отсутствует в кэше/);
});

test("completed reimport replaces an ID cut at the list boundary and keeps description references first", async t => {
  const { service } = fixture(t);
  const closedDate = new Date().toISOString();
  const description = "x".repeat(393) + " #123456 and #765432";
  let detailReads = 0;
  mock(t, [], url => {
    if (url.searchParams.get("searchCriteria.status") === "completed")
      return { value: [{ ...pr(), status: "completed", closedDate, title: "Title #987654", description: description.slice(0, 400) }] };
    if (/\/pullrequests\/1$/.test(url.pathname)) {
      detailReads++;
      return { ...pr(), status: "completed", closedDate, title: "Title #987654", description };
    }
    if (url.pathname.endsWith("/workitems")) return { value: [] };
  });
  const monitor = service.monitors()[0].id;
  const initial = await service.completed(monitor, 0);
  assert.equal(detailReads, 0);
  assert.ok(initial.items[0].tickets.some((ticket: any) => ticket.id === 12345));
  const updated = await service.reimportCompleted(monitor, "repo", 1);
  assert.equal(detailReads, 1);
  assert.equal(updated.description, description);
  assert.deepEqual(updated.tickets.map((ticket: any) => ticket.id), [123456, 765432, 987654]);
  const reopened = await service.completed(monitor, 0);
  assert.equal(detailReads, 1);
  assert.deepEqual(reopened.items[0].tickets.map((ticket: any) => ticket.id), [123456, 765432, 987654]);
});

test("repository history uses selected branch, bounded pages and pinned head without requiring a PR", async t => {
  const { service } = fixture(t);
  const head = "a".repeat(40);
  const queries: URL[] = [];
  mock(t, [], url => {
    if (url.pathname.endsWith('/commits')) {
      queries.push(url);
      return { value: Array.from({ length: queries.length === 1 ? 51 : 1 }, (_, i) => ({ commitId: i === 0 ? head : i.toString(16).padStart(40, '0'), comment: 'Commit', author: { name: 'Dev', date: '2026-01-01' } })) };
    }
  });
  const first = await service.repositoryCommits(context, 'feature/ветка с пробелом');
  assert.equal(first.commits.length, 50);
  assert.equal(first.nextOffset, 50);
  assert.equal(first.head, head);
  assert.equal(queries[0].searchParams.get('searchCriteria.itemVersion.version'), 'feature/ветка с пробелом');
  assert.equal(queries[0].searchParams.get('searchCriteria.itemVersion.versionType'), 'branch');
  const second = await service.repositoryCommits(context, 'feature/ветка с пробелом', 50, first.head);
  assert.equal(second.nextOffset, null);
  assert.equal(queries[1].searchParams.get('searchCriteria.itemVersion.versionType'), 'commit');
  assert.equal(queries[1].searchParams.get('searchCriteria.itemVersion.version'), head);
  assert.equal(queries[1].searchParams.get('searchCriteria.$skip'), '50');
  await assert.rejects(service.repositoryCommits({ client: 'Missing', project: 'Missing' }, 'dev'), /Настройте/);
});

test("repository initial commit compares against empty tree and never reads comments or LLM", async t => {
  const { service, calls } = fixture(t);
  const head = 'b'.repeat(40);
  mock(t, [], url => {
    if (url.pathname.endsWith('/commits/' + head)) return { commitId: head, parents: [], comment: 'Initial' };
    if (url.pathname.endsWith('/changes')) return { changes: [{ changeType: 'add', item: { path: '/src/start.ts' } }] };
    if (url.pathname.endsWith('/items')) {
      assert.equal(url.searchParams.get('versionDescriptor.version'), head);
      return { content: 'export const start = true;\n', size: 27 };
    }
    throw new Error('Unexpected endpoint: ' + url.pathname);
  });
  const diff = await service.repositoryCommitDiff(context, head);
  assert.equal(diff.base, '');
  assert.equal(diff.title, 'Initial');
  assert.equal(diff.patches.length, 1);
  assert.match(diff.patches[0], /--- \/dev\/null/);
  assert.match(diff.patches[0], /\+export const start/);
  assert.equal(calls.length, 0);
});


test("repository settings persist zero depth and reject invalid depth", t => {
  const { service } = fixture(t);
  const settings = { ...context, repository: "repo", mode: "all" as const, enabled: true, fetchDepth: 0 };
  service.save(settings);
  assert.equal(service.monitors()[0].fetch_depth, 0);
  assert.throws(() => service.save({ ...settings, fetchDepth: -1 }));
  assert.throws(() => service.save({ ...settings, fetchDepth: 1001 }));
});

test("active reimport refreshes only one PR and preserves local links and exclusions", async t => {
  const {service,store}=fixture(t);
  let refresh=false, fail=false, status="active";
  const requested:string[]=[];
  mock(t,[pr(1),pr(2)],url=>{
    requested.push(url.pathname);
    if(refresh && /\/pullrequests\/1$/.test(url.pathname)) return {...pr(1,"new-head"),status,title:"Fresh active",description:"Full description #222222",mergeStatus:"succeeded"};
    if(refresh && url.pathname.endsWith("/workitems")) return fail ? {} : {value:[{id:"333333"}]};
  });
  await service.sync();
  const monitor=service.monitors()[0].id;
  store.db.prepare("INSERT INTO pr_ticket_links VALUES (?,?,?,?)").run(monitor,"repo",1,444444);
  store.db.prepare("INSERT INTO pr_ticket_exclusions VALUES (?,?,?,?)").run(monitor,"repo",1,333333);
  refresh=true;fail=true;requested.length=0;
  await assert.rejects(service.reimportActive(monitor,"repo",1),/Локальный кэш сохранён/);
  assert.ok(service.list(context).find(p=>p.number===1).tickets.some((t:any)=>t.id===444444));
  fail=false;
  const result=await service.reimportActive(monitor,"repo",1);
  assert.equal(result.title,"Fresh active");assert.equal(result.head,"new-head");assert.equal(result.in_scope,1);
  assert.deepEqual(result.tickets.map((t:any)=>t.id),[222222,333333,444444]);
  assert.ok(result.tickets.find((t:any)=>t.id===444444).manual);
  assert.ok(result.tickets.find((t:any)=>t.id===333333).disabled);
  assert.equal(service.list(context).find(p=>p.number===2).title,"Change");
  assert.ok(requested.every(path=>!path.endsWith('/pullrequests') && !path.endsWith('/pullrequests/2')));
  status="completed";
  await assert.rejects(service.reimportActive(monitor,"repo",1),/больше не активен/);
  assert.equal(service.list(context).find(p=>p.number===1).title,"Fresh active");
});

test("PR counters cache metadata by revision and never read file content",async t=>{
 const {service,store}=fixture(t);
 let counting=false;const paths:string[]=[];
 mock(t,[pr()],url=>{
   if(!counting)return;
   paths.push(url.pathname);
   if(url.pathname.endsWith('/diffs/commits'))return {commonCommit:'base',allChangesIncluded:true,changes:[{item:{path:'/a.ts'}},{item:{path:'/b.ts'}}]};
   if(url.pathname.endsWith('/commits'))return {value:[{commitId:'one'},{commitId:'two'}]};
   throw new Error('Unexpected request '+url.pathname);
 });
 await service.sync();counting=true;
 const monitor=service.monitors()[0].id;
 const first=await service.counts(monitor,'repo',1);
 assert.deepEqual(first,{files:{value:2,complete:true},commits:{value:2,complete:true}});
 assert.deepEqual(await service.counts(monitor,'repo',1),first);assert.equal(paths.length,2);
 const realNow=Date.now();
 const clock=t.mock.method(Date,"now",()=>realNow+24*60*60*1000);
 assert.deepEqual(await service.counts(monitor,'repo',1),first);assert.equal(paths.length,2);
 clock.mock.restore();
 store.db.prepare("UPDATE pull_requests SET synced_at='manual-refresh' WHERE number=1").run();
 await service.counts(monitor,'repo',1);assert.equal(paths.length,4);
 store.db.prepare("UPDATE pull_requests SET head='updated' WHERE number=1").run();
 await service.counts(monitor,'repo',1);assert.equal(paths.length,6);
 assert.ok(paths.every(path=>!path.endsWith('/items')));
});
