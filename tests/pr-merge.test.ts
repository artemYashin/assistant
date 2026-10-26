import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, AppError } from "../services/backend/src/store.js";
import { PrMerge } from "../services/backend/src/pr-merge.js";
import type { Connectors } from "../services/backend/src/connectors.js";

function fixture(t: any, bypass = false) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-merge-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  store.set("settings", {
    ...store.settings(),
    azureUrl: "https://ado.test",
    azureProject: "Project",
  });
  store.setSecret("azure.pat", "test");
  store.db
    .prepare(
      "INSERT INTO pr_projects(id,client,project,source,azure_project,repository,mode,enabled) VALUES ('monitor','Client','Project','https://ado.test','Project','repo','all',1)",
    )
    .run();
  store.db
    .prepare(
      "INSERT INTO pull_requests(monitor,repo,number,title,author,url,head,target,draft,in_scope,synced_at) VALUES ('monitor','repo',1,'Test','Author','https://ado.test','head','target',0,1,'now')",
    )
    .run();
  let denialStatus = 403;
  let title = "Test";
  let merged = false,
    failMerge = false,
    failTicket = false,
    head = "head";
  const writes: any[] = [];
  const relations = new Map<number, any[]>();
  const linkWrites: number[] = [];
  let failLink = 0;
  let loseLinkResponse = false;
  let conflictLink = false;
  const connectors = {
    ticketStates: async (id: number) => ({
      source: store.source(),
      state: "Active",
      states: id === 42 ? ["Active", "Resolved"] : ["Active", "Done"],
    }),
    changeTicketStatus: async (id: number, state: string, guard: () => void) => {
      guard();
      assert.ok(merged, "Must verify merge before ticket writes");
      writes.push({ id, state });
      if (failTicket) throw new AppError(502, "State not verified");
      return { success: true };
    },
  } as unknown as Connectors;
  t.mock.method(globalThis, "fetch", async (raw: any, init: any) => {
    const path = new URL(String(raw)).pathname;
    let data: any;
    const workItem = /\/wit\/workitems\/(\d+)$/.exec(path);
    if (workItem) {
      const id = Number(workItem[1]);
      if (init.method === "PATCH") {
        assert.equal(init.headers["Content-Type"], "application/json-patch+json");
        const body = JSON.parse(init.body);
        assert.deepEqual(body[0], { op: "test", path: "/rev", value: 1 });
        assert.equal(body[1].value.rel, "ArtifactLink");
        if (failLink === id) return Response.json({}, { status: 403 });
        relations.set(id, [...(relations.get(id) || []), body[1].value]);
        linkWrites.push(id);
        if (conflictLink) {
          conflictLink = false;
          return Response.json({}, { status: 409 });
        }
        if (loseLinkResponse) {
          loseLinkResponse = false;
          throw new Error("Response lost");
        }
      }
      return Response.json({ id, rev: 1, relations: relations.get(id) || [] });
    }
    if (init.method === "PATCH") {
      const body = JSON.parse(init.body);
      writes.push(body);
      assert.equal(body.completionOptions.transitionWorkItems, false);
      assert.equal(body.completionOptions.mergeCommitMessage, `Merged PR 1: ${title}`);
      assert.equal(body.completionOptions.bypassPolicy, bypass);
      if (!bypass) assert.equal(body.completionOptions.bypassReason, undefined);
      assert.equal(body.completionOptions.deleteSourceBranch, false);
      assert.equal(body.lastMergeSourceCommit.commitId, "head");
      if (failMerge)
        return new Response("{}", {
          status: denialStatus,
          headers: { "Content-Type": "application/json" },
        });
      merged = true;
      data = { status: "completed" };
    } else if (path.endsWith("/policy/evaluations")) data = { value: [] };
    else if (path.endsWith("/workitems")) data = { value: [{ id: "43" }] };
    else
      data = {
        pullRequestId: 1,
        repository: { id: "repo", project: { id: "project-id" } },
        status: merged ? "completed" : "active",
        lastMergeSourceCommit: { commitId: head },
        lastMergeTargetCommit: { commitId: "target" },
        sourceRefName: "refs/heads/feature/test",
        targetRefName: "refs/heads/dev",
        description: "Fix #42",
        title,
      };
    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json" },
    });
  });
  const service = new PrMerge(store, connectors);
  return {
    service,
    connectors,
    store,
    writes,
    relations,
    linkWrites,
    setFailLink: (id: number) => {
      failLink = id;
    },
    loseLinkResponse: () => {
      loseLinkResponse = true;
    },
    conflictLink: () => {
      conflictLink = true;
    },
    key: { monitor: "monitor", repo: "repo", number: 1 },
    setTitle: (value: string) => {
      title = value;
    },
    setFailMerge: (status = 403) => {
      failMerge = true;
      denialStatus = status;
    },
    allowMerge: () => {
      failMerge = false;
    },
    setFailTicket: () => {
      failTicket = true;
    },
    changeHead: () => {
      head = "new";
    },
  };
}
const selection = [
  { id: 42, state: "Resolved" },
  { id: 43, state: "Done" },
];
test("merge prepares actual and mentioned tickets, verifies merge before transitions and deduplicates", async (t) => {
  const f = fixture(t),
    p = await f.service.prepare(f.key);
  assert.deepEqual(
    p.tickets.map((t) => t.id),
    [42, 43],
  );
  assert.equal(f.writes.length, 0);
  const result = await f.service.execute(p.id, selection, "squash");
  assert.equal(result.status, "completed");
  assert.equal(f.writes.length, 3);
  assert.deepEqual(await f.service.execute(p.id, selection, "squash"), result);
  assert.equal(f.writes.length, 3);
});
test("merge rejects stale commits and invalid per-type states without any writes", async (t) => {
  const f = fixture(t),
    p = await f.service.prepare(f.key);
  await assert.rejects(() =>
    f.service.execute(
      p.id,
      [
        { id: 42, state: "Resolved" },
        { id: 43, state: "Resolved" },
      ],
      "squash",
    ),
  );
  assert.equal(f.writes.length, 0);
  f.changeHead();
  await assert.rejects(() => f.service.execute(p.id, selection, "squash"));
  assert.equal(f.writes.length, 0);
});
test("denied merge never transitions tickets or retries the same plan", async (t) => {
  const f = fixture(t),
    p = await f.service.prepare(f.key);
  f.setFailMerge();
  const result = await f.service.execute(p.id, selection, "squash");
  assert.equal(result.status, "rejected");
  assert.equal(f.writes.length, 1);
  await f.service.execute(p.id, selection, "squash");
  assert.equal(f.writes.length, 1);
});
test("ticket failures after confirmed merge are reported as partial", async (t) => {
  const f = fixture(t),
    p = await f.service.prepare(f.key);
  f.setFailTicket();
  const result = await f.service.execute(p.id, selection, "squash");
  assert.equal(result.status, "partial");
  assert.ok(result.merged);
  assert.equal(result.tickets.length, 2);
  assert.ok(result.tickets.every((t: any) => !t.success));
});

test("merge-only skips work item access and rejects ticket changes in confirmation", async (t) => {
  const f = fixture(t);
  t.mock.method(f.connectors, "ticketStates", async () => {
    throw new Error("Ticket states must not be read");
  });
  t.mock.method(f.connectors, "changeTicketStatus", async () => {
    throw new Error("Tickets must not be written");
  });
  const originalFetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", async (raw: any, init: any) => {
    assert.ok(!String(raw).includes("/workitems"), "Merge-only must not load work item links");
    return originalFetch(raw, init);
  });
  const p = await f.service.prepare(f.key, false);
  assert.equal(p.moveTickets, false);
  assert.deepEqual(p.tickets, []);
  await assert.rejects(() => f.service.execute(p.id, selection, "squash"));
  assert.equal(f.writes.length, 0);
  const result = await f.service.execute(p.id, [], "squash");
  assert.equal(result.status, "completed");
  assert.deepEqual(result.tickets, []);
  assert.equal(f.writes.length, 1);
});

test("new confirmation can retry permission rejection, including persisted legacy results", async (t) => {
  const f = fixture(t),
    p = await f.service.prepare(f.key);
  f.setFailMerge(401);
  await f.service.execute(p.id, selection, "squash");
  // Simulate the legacy result already present on a user's machine.
  f.store.db.prepare("UPDATE pr_merge_plans SET result=? WHERE id=?").run(
    JSON.stringify({
      status: "unconfirmed",
      message: "Merge не подтверждён. HTTP 401. Проверьте PAT.",
      tickets: [],
    }),
    p.id,
  );
  f.allowMerge();
  const next = await f.service.prepare(f.key);
  assert.notEqual(next.id, p.id);
  assert.equal((await f.service.execute(next.id, selection, "squash")).status, "completed");
  assert.equal(f.writes.length, 4);
});
test("ambiguous merge stays blocked and new dialogs resolve the original result", async (t) => {
  const f = fixture(t),
    p = await f.service.prepare(f.key);
  f.setFailMerge(500);
  const first = await f.service.execute(p.id, selection, "squash");
  assert.equal(first.status, "unconfirmed");
  f.allowMerge();
  const next = await f.service.prepare(f.key);
  const result = await f.service.execute(next.id, selection, "squash");
  assert.equal(result.status, "unconfirmed");
  assert.equal(result.operationId, p.id);
  assert.equal(f.service.result(next.id).operationId, p.id);
  assert.equal(f.writes.length, 1);
});

test("merge ticket discovery combines links read-only without preparing or merging", async (t) => {
  const f = fixture(t);
  const result = await f.service.linkedTickets(f.key);
  assert.deepEqual(result.ids, [42, 43]);
  assert.equal(f.writes.length, 0);
  assert.equal((f.store.db.prepare("SELECT count(*) n FROM pr_merge_plans").get() as any).n, 0);
});

test("merge explicitly skips unselected ticket statuses", async (t) => {
  const f = fixture(t);
  const p = await f.service.prepare(f.key);
  const result = await f.service.execute(
    p.id,
    [
      { id: 42, state: null },
      { id: 43, state: "Done" },
    ],
    "squash",
  );
  assert.equal(result.status, "completed");
  assert.deepEqual(
    f.writes.filter((w) => w.id),
    [{ id: 43, state: "Done" }],
  );
  assert.equal(result.tickets.find((v: any) => v.id === 42).skipped, true);
});

test("policy bypass is explicit, requires a reason and preserves merge verification", async (t) => {
  const f = fixture(t, true);
  const plan = await f.service.prepare(f.key, false);
  await assert.rejects(
    f.service.execute(plan.id, [], "squash", { enabled: true, reason: "   " }),
    /причину/,
  );
  assert.equal(f.writes.length, 0);
  const result = await f.service.execute(plan.id, [], "squash", {
    enabled: true,
    reason: "Approved exception",
  });
  assert.equal(f.writes[0].completionOptions.bypassReason, "Approved exception");
  assert.equal(f.writes[0].completionOptions.transitionWorkItems, false);
  assert.equal(f.writes.length, 1);
  assert.deepEqual(
    await f.service.execute(plan.id, [], "squash", {
      enabled: true,
      reason: "Approved exception",
    }),
    result,
  );
  assert.equal(f.writes.length, 1);
});

test("merge commit uses the current PR title after the dialog was opened", async (t) => {
  const f = fixture(t);
  const plan = await f.service.prepare(f.key, false);
  f.setTitle("Исправление авторизации — updated title");
  await f.service.execute(plan.id, [], "noFastForward");
  assert.equal(
    f.writes[0].completionOptions.mergeCommitMessage,
    "Merged PR 1: Исправление авторизации — updated title",
  );
});

test("merge allows running CI and preserves explicit policy bypass", async (t) => {
  const f = fixture(t, true);
  const plan = await f.service.prepare(f.key, false);
  const original = globalThis.fetch;
  t.mock.method(globalThis, "fetch", async (raw: any, init: any) => {
    if (new URL(String(raw)).pathname.endsWith("/policy/evaluations"))
      return Response.json({
        value: [{ status: "running", configuration: { settings: { buildDefinitionId: 1 } } }],
      });
    return original(raw, init);
  });
  await f.service.execute(plan.id, [], "squash", { enabled: true, reason: "Test" });
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].completionOptions.bypassPolicy, true);
});

test("merge omits locally disabled Azure and textual links", async (t) => {
  const { store, service, key } = fixture(t);
  store.db
    .prepare("INSERT INTO pr_ticket_exclusions VALUES (?,?,?,?)")
    .run(key.monitor, key.repo, key.number, 43);
  assert.deepEqual((await service.linkedTickets(key)).ids, [42]);
  const plan = await service.prepare(key);
  assert.deepEqual(
    plan.tickets.map((t) => t.id),
    [42],
  );
  store.db
    .prepare("INSERT INTO pr_ticket_exclusions VALUES (?,?,?,?)")
    .run(key.monitor, key.repo, key.number, 42);
  assert.deepEqual((await service.linkedTickets(key)).ids, []);
});

test("merge preparation exposes current source and target branch names", async (t) => {
  const { service, key } = fixture(t);
  const plan = await service.prepare(key, false);
  assert.equal(plan.sourceBranch, "refs/heads/feature/test");
  assert.equal(plan.targetBranch, "refs/heads/dev");
});

function addLocal(f: ReturnType<typeof fixture>, id: number) {
  f.store.db
    .prepare(
      "INSERT INTO pr_ticket_links(monitor,repo,number,ticket_id) VALUES ('monitor','repo',1,?)",
    )
    .run(id);
}
test("merge publishes manual links only, preserves other relations and skips existing Azure PR artifacts", async (t) => {
  const f = fixture(t);
  addLocal(f, 51);
  addLocal(f, 52);
  addLocal(f, 53);
  f.store.db
    .prepare(
      "INSERT INTO pr_ticket_exclusions(monitor,repo,number,ticket_id) VALUES ('monitor','repo',1,53)",
    )
    .run();
  const existing = {
    rel: "ArtifactLink",
    url: "vstfs:///Git/PullRequestId/project-id/repo/1",
    attributes: { name: "Pull Request" },
  };
  const unrelated = { rel: "Hyperlink", url: "https://example.test" };
  f.relations.set(51, [existing, unrelated]);
  const plan = await f.service.prepare(f.key, false, true);
  assert.deepEqual(plan.localTicketIds, [51, 52]);
  assert.equal(f.linkWrites.length, 0);
  const result = await f.service.execute(plan.id, [], "squash");
  assert.equal(result.merged, true);
  assert.deepEqual(result.linkedTickets, [51, 52]);
  assert.deepEqual(f.linkWrites, [52]);
  assert.deepEqual(f.relations.get(51), [existing, unrelated]);
  assert.equal(f.writes.length, 1, "No state transitions when only linking is selected");
});
test("partial link failure prevents merge and retry preserves confirmed links without duplicates", async (t) => {
  const f = fixture(t);
  addLocal(f, 51);
  addLocal(f, 52);
  f.setFailLink(52);
  const plan = await f.service.prepare(f.key, false, true);
  const result = await f.service.execute(plan.id, [], "squash");
  assert.equal(result.status, "rejected");
  assert.deepEqual(result.linkedTickets, [51]);
  assert.equal(f.writes.length, 0);
  f.setFailLink(0);
  const retry = await f.service.prepare(f.key, false, true);
  assert.equal((await f.service.execute(retry.id, [], "squash")).merged, true);
  assert.deepEqual(f.linkWrites, [51, 52]);
});
test("lost patch response and concurrent duplicate are reconciled by rereading Azure", async (t) => {
  const f = fixture(t);
  addLocal(f, 51);
  addLocal(f, 52);
  f.loseLinkResponse();
  f.conflictLink();
  const plan = await f.service.prepare(f.key, false, true);
  assert.equal((await f.service.execute(plan.id, [], "squash")).merged, true);
  assert.deepEqual(f.linkWrites, [51, 52]);
});
test("old merge plans and unchecked option never publish local links; changed local selection rejects before writes", async (t) => {
  const f = fixture(t);
  addLocal(f, 51);
  const selected = await f.service.prepare(f.key, false, true);
  addLocal(f, 52);
  await assert.rejects(f.service.execute(selected.id, [], "squash"), /Локальные связи изменились/);
  assert.equal(f.linkWrites.length, 0);
  const plan = await f.service.prepare(f.key, false);
  const old = { ...plan };
  delete old.linkLocalTickets;
  delete old.localTicketIds;
  f.store.db
    .prepare("UPDATE pr_merge_plans SET body=? WHERE id=?")
    .run(JSON.stringify(old), plan.id);
  assert.equal((await f.service.execute(plan.id, [], "squash")).merged, true);
  assert.equal(f.linkWrites.length, 0);
});

test("links survive a denied merge and a new merge plan does not duplicate them", async (t) => {
  const f = fixture(t);
  addLocal(f, 51);
  f.setFailMerge();
  const plan = await f.service.prepare(f.key, false, true);
  const denied = await f.service.execute(plan.id, [], "squash");
  assert.equal(denied.status, "rejected");
  assert.deepEqual(denied.linkedTickets, [51]);
  f.allowMerge();
  const retry = await f.service.prepare(f.key, false, true);
  assert.equal((await f.service.execute(retry.id, [], "squash")).merged, true);
  assert.deepEqual(f.linkWrites, [51]);
});
