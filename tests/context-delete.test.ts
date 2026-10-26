import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { Store } from "../services/backend/src/store.js";
import { deleteContext } from "../services/backend/src/context-delete.js";
import { createApp } from "../services/backend/src/app.js";
function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-delete-context-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  for (const context of [
    { client: "A", project: "One" },
    { client: "A", project: "Two" },
    { client: "B", project: "One" },
  ])
    store.addContext(context);
  return store;
}
function seed(store: Store, client: string, project: string, id: string) {
  const context = { client, project };
  const chat = store.createChat(context);
  store.say("user", "Private chat", context, [], chat.id);
  store.db
    .prepare(
      "INSERT INTO memories(id,scope,client,project,body,created_at) VALUES (?,'project',?,?,?,'now')",
    )
    .run(id, client, project, "Private memory");
  store.db
    .prepare(
      "INSERT INTO memory_proposals(id,scope,client,project,body,reason,status,created_at) VALUES (?,'project',?,?,'Private draft','Reason','pending','now')",
    )
    .run(id, client, project);
  store.db
    .prepare(
      "INSERT INTO pr_projects(id,client,project,source,azure_project,mode,enabled) VALUES (?,?,?,'source','Azure','all',1)",
    )
    .run(id, client, project);
  store.db
    .prepare(
      "INSERT INTO pr_reviews(id,monitor,repo,number,head,target,status,created_at) VALUES (?,?,'repo',1,'head','base','queued','now')",
    )
    .run(id, id);
  store.db
    .prepare("INSERT INTO pr_question_batches VALUES (?,?,?,'[]','pending','now')")
    .run(id, id, "[]");
  store.db.prepare("INSERT INTO pr_review_attempts VALUES (?,?,'now')").run(id, id);
  store.db
    .prepare(
      "INSERT INTO llm_requests(id,created_at,model,client,project,status) VALUES (?,'now','model',?,?,'completed')",
    )
    .run(id, client, project);
  store.db
    .prepare(
      "INSERT INTO llm_usage(request_id,receipt_id,model,input_tokens,output_tokens) VALUES (?,'receipt','model',100,20)",
    )
    .run(id);
  store.db
    .prepare(
      "INSERT INTO llm_tool_traces(id,request_id,name,arguments,internal,status,started_at) VALUES (?,?,'tool','{}',0,'completed','now')",
    )
    .run(id, id);
  store.db
    .prepare("INSERT INTO local_developers(id,name,client,project) VALUES (?,'Dev',?,?)")
    .run(id, client, project);
  store.db.prepare("INSERT INTO ticket_developers VALUES ('shared',1,?)").run(id);
  store.set(`chat.runtime:${chat.id}`, { sessionId: id });
  store.set(`review.requests:${id}`, [id]);
  store.set(`code.snapshot:${id}:main`, { sha: "hash" });
  store.set(`pr.source:${JSON.stringify([id, "repo", 1])}`, {});
  store.set(store.azureContextKey(context), {
    azureUrl: "https://azure.test",
    azureProject: "Shared",
  });
  return chat.id;
}
test("project deletion is transactional and isolates other projects and shared tickets", (t) => {
  const store = fixture(t),
    chat = seed(store, "A", "One", "one");
  seed(store, "A", "Two", "two");
  seed(store, "B", "One", "other");
  store.set("settings", { ...store.rawSettings(), client: "A", project: "One" });
  store.db
    .prepare(
      "INSERT INTO tickets VALUES ('shared',1,'Shared ticket','Active','','Bug','url',NULL,'now')",
    )
    .run();
  assert.throws(
    () => deleteContext(store, { client: "A", project: "One" }, "Удалить"),
    /подтверждения/,
  );
  store.db.prepare("UPDATE pr_reviews SET status='running' WHERE id='one'").run();
  assert.throws(() => deleteContext(store, { client: "A", project: "One" }, "удалить"), /ревью/);
  assert.ok(store.db.prepare("SELECT 1 FROM memories WHERE id='one'").get());
  store.db.prepare("UPDATE pr_reviews SET status='queued' WHERE id='one'").run();
  const result = deleteContext(store, { client: "A", project: "One" }, "удалить");
  assert.deepEqual(result.context, { client: "A", project: "" });
  for (const table of [
    "memories",
    "memory_proposals",
    "pr_projects",
    "pr_reviews",
    "pr_question_batches",
    "pr_review_attempts",
    "llm_requests",
    "llm_tool_traces",
    "local_developers",
  ]) {
    assert.equal(store.db.prepare(`SELECT 1 FROM ${table} WHERE id='one'`).get(), undefined, table);
    assert.ok(store.db.prepare(`SELECT 1 FROM ${table} WHERE id='two'`).get(), table);
  }
  assert.equal(
    store.db.prepare("SELECT 1 FROM conversations WHERE session_id=?").get(chat),
    undefined,
  );
  assert.equal(store.db.prepare("SELECT 1 FROM llm_usage WHERE request_id='one'").get(), undefined);
  assert.equal(
    store.db.prepare("SELECT 1 FROM ticket_developers WHERE developer_id='one'").get(),
    undefined,
  );
  assert.ok(store.db.prepare("SELECT 1 FROM tickets WHERE source='shared'").get());
  assert.equal(store.get(`chat.runtime:${chat}`, null), null);
  assert.equal(store.get("code.snapshot:one:main", null), null);
  assert.equal(store.azureBinding({ client: "A", project: "One" }), null);
  assert.deepEqual(store.db.pragma("foreign_key_check"), []);
  assert.ok(result.items.some((c) => c.client === "A" && c.project === "Two"));
});
test("customer deletion removes all its projects but preserves global memory and other customers", (t) => {
  const store = fixture(t);
  seed(store, "A", "One", "one");
  seed(store, "A", "Two", "two");
  seed(store, "B", "One", "other");
  store.set("settings", { ...store.rawSettings(), client: "A", project: "Two" });
  store.db
    .prepare(
      "INSERT INTO memories(id,scope,client,project,body,created_at) VALUES ('global','general','','','Global','now')",
    )
    .run();
  const result = deleteContext(store, { client: "A", project: "" }, "удалить");
  assert.deepEqual(result.context, { client: "", project: "" });
  assert.ok(result.items.every((c) => c.client !== "A"));
  assert.ok(store.db.prepare("SELECT 1 FROM memories WHERE id='global'").get());
  assert.ok(store.db.prepare("SELECT 1 FROM memories WHERE id='other'").get());
  assert.throws(() => deleteContext(store, { client: "", project: "" }, "удалить"), /Общий/);
  assert.throws(() => deleteContext(store, { client: "A", project: "" }, "удалить"), /не найден/);
});
test("delete API requires exact typed confirmation and rejects active agent work", async (t) => {
  const store = fixture(t);
  const { app, agent, reviewAgent, pullRequests } = createApp(store);
  const headers = {
    Host: "localhost:43871",
    Origin: "http://localhost:43871",
    "X-Orbit-Request": "1",
  };
  const setup = await request(app)
    .post("/api/auth/setup")
    .set(headers)
    .send({ password: "long-enough-password" })
    .expect(200);
  const auth = {
    ...headers,
    Cookie: setup.headers["set-cookie"][0].split(";")[0],
    "X-CSRF-Token": setup.body.csrf,
  };
  await request(app)
    .delete("/api/contexts")
    .set(auth)
    .send({ context: { client: "A", project: "One" } })
    .expect(400);
  const active = t.mock.method(agent, "active", () => ({}) as any);
  await request(app)
    .delete("/api/contexts")
    .set(auth)
    .send({ context: { client: "A", project: "One" }, confirmation: "удалить" })
    .expect(409);
  active.mock.restore();
  const reviewing = t.mock.method(reviewAgent, "active", () => "review-request");
  await request(app)
    .delete("/api/contexts")
    .set(auth)
    .send({ context: { client: "A", project: "One" }, confirmation: "удалить" })
    .expect(409);
  reviewing.mock.restore();
  const preparing = t.mock.method(pullRequests, "hasActiveReview", () => true);
  await request(app)
    .delete("/api/contexts")
    .set(auth)
    .send({ context: { client: "A", project: "One" }, confirmation: "удалить" })
    .expect(409);
  preparing.mock.restore();
  await request(app)
    .delete("/api/contexts")
    .set(auth)
    .send({ context: { client: "A", project: "One" }, confirmation: "удалить" })
    .expect(200);
});

test("app wires review separately and usage cancellation targets an exact request", async (t) => {
  const store = fixture(t);
  const { app, agent, reviewAgent, pullRequests } = createApp(store);
  assert.notEqual(agent, reviewAgent);
  assert.equal((pullRequests as any).agent, reviewAgent);
  const headers = {
    Host: "localhost:43871",
    Origin: "http://localhost:43871",
    "X-Orbit-Request": "1",
  };
  const setup = await request(app)
    .post("/api/auth/setup")
    .set(headers)
    .send({ password: "long-enough-password" })
    .expect(200);
  const auth = {
    ...headers,
    Cookie: setup.headers["set-cookie"][0].split(";")[0],
    "X-CSRF-Token": setup.body.csrf,
  };
  t.mock.method(agent, "active", () => "chat-request");
  t.mock.method(reviewAgent, "active", () => "review-request");
  const stopChat = t.mock.method(agent, "stop", () => ({ stopping: true }));
  const stopReview = t.mock.method(reviewAgent, "stop", () => ({ stopping: true }));
  store.db
    .prepare(
      "INSERT INTO pr_projects(id,client,project,source,azure_project,mode,enabled) VALUES ('m','A','One','source','Azure','all',1)",
    )
    .run();
  store.db
    .prepare(
      "INSERT INTO pr_reviews(id,monitor,repo,number,head,target,status,created_at) VALUES ('r','m','repo',1,'head','base','running','now')",
    )
    .run();
  (pullRequests as any).modelReviewId = "r";
  const report = await request(app).get("/api/usage").set(auth).expect(200);
  assert.deepEqual(report.body.activeRequests, [
    { id: "chat-request", origin: "chat" },
    { id: "review-request", origin: "pr_review" },
  ]);
  await request(app).post("/api/usage/requests/old-request/stop").set(auth).send({}).expect(409);
  assert.equal(stopChat.mock.callCount(), 0);
  assert.equal(stopReview.mock.callCount(), 0);
  await request(app).post("/api/conversation/stop").set(auth).send({}).expect(200);
  assert.equal(stopChat.mock.callCount(), 1);
  assert.equal(stopReview.mock.callCount(), 0);
  await request(app).post("/api/usage/requests/review-request/stop").set(auth).send({}).expect(200);
  assert.equal(stopChat.mock.callCount(), 1);
  assert.equal(stopReview.mock.callCount(), 1);
  assert.equal(
    (store.db.prepare("SELECT status FROM pr_reviews WHERE id='r'").get() as any).status,
    "interrupted",
  );
});
