import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { Store } from "../services/backend/src/store.js";
import { PullRequests } from "../services/backend/src/pull-requests.js";
import { createApp } from "../services/backend/src/app.js";

const a = { client: "Customer", project: "A" };
const b = { client: "Customer", project: "B" };
function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-pr-project-sync-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  store.setSecret("azure.pat", "fixture-pat");
  store.set("settings", { ...store.rawSettings(), ...a });
  for (const context of [a, b]) {
    store.addContext(context);
    store.set(store.azureContextKey(context), {
      azureUrl: `https://dev.azure.com/org-${context.project}`,
      azureProject: `Azure-${context.project}`,
    });
    store.db
      .prepare(
        "INSERT INTO pr_projects(id,client,project,source,azure_project,mode,enabled,repository) VALUES (?,?,?,?,?,?,?,?)",
      )
      .run(
        context.project,
        context.client,
        context.project,
        `https://dev.azure.com/org-${context.project}`,
        `Azure-${context.project}`,
        "all",
        1,
        `repo-${context.project}`,
      );
  }
  return store;
}

function mockAzure(t: any, store: Store, switchDuringFetch = false) {
  const paths: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: any) => {
    const url = new URL(String(input));
    paths.push(url.pathname);
    const project = url.pathname.includes("org-A") ? "A" : "B";
    if (switchDuringFetch) store.set("settings", { ...store.rawSettings(), ...b });
    const pr = {
      pullRequestId: 7,
      repository: { id: `repo-${project}` },
      title: "PR fixture",
      description: "Linked #42",
      lastMergeSourceCommit: { commitId: "head" },
      lastMergeTargetCommit: { commitId: "target" },
    };
    let result: unknown;
    if (url.pathname.endsWith("/pullrequests")) result = { value: [pr] };
    else if (url.pathname.endsWith("/pullrequests/7")) result = pr;
    else if (url.pathname.endsWith("/workitems")) result = { value: [{ id: 42 }] };
    else if (url.pathname.endsWith("/workitemsbatch"))
      result = {
        value: [
          {
            id: 42,
            fields: {
              "System.TeamProject": `Azure-${project}`,
              "System.Title": `Ticket ${project}`,
              "System.State": "New",
            },
          },
        ],
      };
    else throw new Error(`Unexpected fixture endpoint ${url.pathname}`);
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  });
  return paths;
}

function service(store: Store) {
  const prs = new PullRequests(store, {
    active: () => null,
    chat: async () => ({ body: "", requestId: "" }),
  });
  // Health is independent of scope resolution and has separate regression coverage.
  (prs as any).readHealth = async () => "{}";
  return prs;
}

test("all-project/background PR sync resolves each owner binding and imports links into its source", async (t) => {
  const store = fixture(t);
  const paths = mockAzure(t, store);
  const prs = service(store);
  await prs.sync();
  assert.deepEqual(
    prs.monitors().map((m) => m.error),
    [null, null],
  );
  assert.deepEqual(store.db.prepare("SELECT source,id,title FROM tickets ORDER BY source").all(), [
    { source: "https://dev.azure.com/org-A|Azure-A", id: 42, title: "Ticket A" },
    { source: "https://dev.azure.com/org-B|Azure-B", id: 42, title: "Ticket B" },
  ]);
  assert.ok(paths.some((path) => path.includes("org-B/Azure-B")));
  store.set("settings", { ...store.rawSettings(), ...b });
  await prs.sync();
  assert.deepEqual(
    prs.monitors().map((m) => m.error),
    [null, null],
  );
});

test("switching active project during PR fetch does not redirect the scan or its linked ticket import", async (t) => {
  const store = fixture(t);
  const paths = mockAzure(t, store, true);
  const prs = service(store);
  await prs.sync("A");
  assert.equal(prs.monitors()[0].error, null);
  assert.ok(paths.length > 0 && paths.every((path) => path.includes("org-A/Azure-A")));
  assert.equal((store.db.prepare("SELECT title FROM tickets").get() as any).title, "Ticket A");
  assert.equal(store.settings().project, "B");
});

test("real owner binding changes reject sync and preserve stored PR and review history", async (t) => {
  const store = fixture(t);
  mockAzure(t, store);
  const prs = service(store);
  await prs.sync("A");
  store.db
    .prepare(
      "INSERT INTO pr_reviews(id,monitor,repo,number,head,target,status,summary,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    )
    .run(
      "review",
      "A",
      "repo-A",
      7,
      "head",
      "target",
      "completed",
      "Saved review",
      new Date().toISOString(),
    );
  const before = store.db.prepare("SELECT * FROM pull_requests").all();
  const reviews = store.db.prepare("SELECT * FROM pr_reviews").all();
  for (const binding of [
    { azureUrl: "https://dev.azure.com/org-A", azureProject: "Changed" },
    { azureUrl: "https://dev.azure.com/changed", azureProject: "Azure-A" },
  ]) {
    store.set(store.azureContextKey(a), binding);
    await prs.sync("A");
    assert.match(prs.monitors()[0].error || "", /изменён/);
    assert.deepEqual(store.db.prepare("SELECT * FROM pull_requests").all(), before);
    assert.deepEqual(store.db.prepare("SELECT * FROM pr_reviews").all(), reviews);
  }
});

test("manual sync captures selected scope, isolates errors and supports client/all views and older clients", async (t) => {
  const store = fixture(t);
  const { app, pullRequests } = createApp(store);
  const headers = {
    Host: "localhost:43871",
    Origin: "http://localhost:43871",
    "X-Orbit-Request": "1",
  };
  const setup = await request(app).post("/api/auth/setup").set(headers).send({}).expect(200);
  const auth = {
    ...headers,
    Cookie: setup.headers["set-cookie"][0].split(";")[0],
    "X-CSRF-Token": setup.body.csrf,
  };
  const calls: string[] = [];
  pullRequests.sync = async (id) => {
    calls.push(id!);
    store.set("settings", { ...store.rawSettings(), ...b });
  };
  store.db.prepare("UPDATE pr_projects SET error='Other project failed' WHERE id='B'").run();
  await request(app).post("/api/pr/sync").set(auth).send(a).expect(200);
  assert.deepEqual(calls.splice(0), ["A"]);
  store.set("settings", { ...store.rawSettings(), ...a });
  await request(app).post("/api/pr/sync").set(auth).send({}).expect(200);
  assert.deepEqual(calls.splice(0), ["A"]);
  await request(app)
    .post("/api/pr/sync")
    .set(auth)
    .send({ client: "Customer", project: "" })
    .expect(502);
  assert.deepEqual(calls.splice(0), ["A", "B"]);
  store.db.prepare("UPDATE pr_projects SET enabled=0 WHERE id='B'").run();
  await request(app).post("/api/pr/sync").set(auth).send({ client: "", project: "" }).expect(200);
  assert.deepEqual(calls.splice(0), ["A"]);
});

test("PAT replacement during fetch rejects scan before persisting results or importing tickets", async (t) => {
  const store = fixture(t);
  const paths = mockAzure(t, store);
  const prs = service(store);
  await prs.sync("A");
  const before = store.db.prepare("SELECT * FROM pull_requests").all();
  paths.length = 0;
  (prs as any).readHealth = async () => {
    store.setSecret("azure.pat", "replacement-pat");
    return "{}";
  };
  await prs.sync("A");
  assert.match(prs.monitors()[0].error || "", /Подключение Azure изменилось/);
  assert.deepEqual(store.db.prepare("SELECT * FROM pull_requests").all(), before);
  assert.ok(paths.every((path) => !path.endsWith("workitemsbatch")));
});

test("owner connection changes in flight preserve the previous populated scan and reviews", async (t) => {
  const store = fixture(t);
  mockAzure(t, store);
  const prs = service(store);
  await prs.sync("A");
  store.db
    .prepare(
      "INSERT INTO pr_reviews(id,monitor,repo,number,head,target,status,summary,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    )
    .run(
      "review",
      "A",
      "repo-A",
      7,
      "head",
      "target",
      "completed",
      "Saved review",
      new Date().toISOString(),
    );
  const before = store.db.prepare("SELECT * FROM pull_requests").all();
  const reviews = store.db.prepare("SELECT * FROM pr_reviews").all();
  (prs as any).readHealth = async () => {
    store.set(store.azureContextKey(a), {
      azureUrl: "https://dev.azure.com/org-A",
      azureProject: "Changed",
    });
    return "{}";
  };
  await prs.sync("A");
  assert.match(prs.monitors()[0].error || "", /Проект Azure изменён/);
  assert.deepEqual(store.db.prepare("SELECT * FROM pull_requests").all(), before);
  assert.deepEqual(store.db.prepare("SELECT * FROM pr_reviews").all(), reviews);
});
