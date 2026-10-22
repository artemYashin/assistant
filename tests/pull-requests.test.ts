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
  service.requestReview(service.monitors()[0].id, "repo", 1);
  const again = new Store(dir);
  again.close();
  assert.equal(
    (
      store.db
        .prepare("SELECT status FROM pr_reviews WHERE id=?")
        .get(id) as any
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
    maxTokens: 1000000,
    memoryScopes: ["general", "client", "project", "project_review"],
  });
  await service.reviewNext();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][3].askQuestions, undefined);
  assert.equal(calls[0][3].questionFrequency, "none");
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

test("completed PR pages are bounded, cached and coalesce concurrent requests", async (t) => {
  const { service } = fixture(t);
  let requests = 0;
  mock(t, [], (url) => {
    if (url.pathname.endsWith("/workitems")) return { value: [] };
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
  assert.equal(requests, 1);
  const next = await service.completed(monitor, 1);
  assert.equal(requests, 2);
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
