import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { Store } from "../services/backend/src/store.js";
import { createApp } from "../services/backend/src/app.js";
import { makeTools } from "../services/backend/src/agent.js";
import { MemoryProposals } from "../services/backend/src/memory-proposals.js";

test("retired integration migration preserves application data and secrets on repeated startup", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-retired-"));
  let store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const context = { client: "Customer", project: "Project" };
  const settings = {
    ...store.rawSettings(),
    azureUrl: "https://ado.test/org",
    azureProject: "Project",
    model: "test-model",
  };
  store.set("settings", {
    ...settings,
    microsoftClientId: "old-client",
    microsoftTenantId: "old-tenant",
    teamsEnabled: false,
  });
  store.set("migration.removeTeams", false);
  store.set("microsoft.connected", false);
  store.set("microsoft.account:old", "account");
  store.setSecret("msal:old", "retired-secret");
  store.setSecret("azure.pat", "keep-pat");
  store.setSecret("github.token", "keep-github");
  store.set("unrelated.preference", { value: 42 });
  const source = store.source();
  store.db
    .prepare(
      "INSERT INTO tickets(source,id,title,state,assigned,type,url,synced_at) VALUES (?,42,'Keep ticket','Active','Dev','Bug','https://ado.test/42',?)",
    )
    .run(source, new Date().toISOString());
  store.db
    .prepare(
      "INSERT INTO ticket_local(source,id,developer_id,developer_name) VALUES (?,42,'dev','Local developer')",
    )
    .run(source);
  store.db
    .prepare(
      "INSERT INTO pr_projects(id,client,project,source,azure_project,mode,enabled) VALUES ('monitor','Customer','Project',?,'Project','all',1)",
    )
    .run(source);
  store.db
    .prepare(
      "INSERT INTO pull_requests(monitor,repo,number,title,author,url,head,target,draft,synced_at) VALUES ('monitor','repo',1,'Keep PR','Dev','https://ado.test/pr/1','head','target',0,?)",
    )
    .run(new Date().toISOString());
  const chat = store.createChat(context);
  store.say("user", "Keep conversation", context, [], chat.id);
  store.addMemory("project", "Keep memory", context);
  new MemoryProposals(store).propose(
    { scope: "project", summary: "Pending", body: "Keep proposal", reason: "Useful" },
    context,
  );
  // Simulate legacy schema and unused integration state from an older installation.
  store.db.exec(`
    CREATE TABLE chats(id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE messages(id TEXT PRIMARY KEY, body TEXT);
    CREATE TABLE suggestions(id TEXT PRIMARY KEY);
    CREATE TABLE approvals(id TEXT PRIMARY KEY);
    INSERT INTO chats VALUES ('old', 'Old chat');
    INSERT INTO messages VALUES ('old', 'Old message');
    INSERT INTO suggestions VALUES ('old');
    INSERT INTO approvals VALUES ('old');
  `);
  const excluded = new Set(["kv", "secrets", "chats", "messages", "suggestions", "approvals"]);
  const tables = (
    store.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
      name: string;
    }[]
  )
    .map((row) => row.name)
    .filter((name) => !excluded.has(name));
  const snapshot = () =>
    Object.fromEntries(
      tables.map((name) => [name, store.db.prepare(`SELECT * FROM "${name}"`).all()]),
    );
  const before = snapshot();
  for (let attempt = 0; attempt < 2; attempt++) {
    store.close();
    store = new Store(dir);
    assert.deepEqual(snapshot(), before);
    assert.deepEqual(store.rawSettings(), settings);
    assert.equal(store.secret("azure.pat"), "keep-pat");
    assert.equal(store.secret("github.token"), "keep-github");
    assert.deepEqual(store.get("unrelated.preference", null), { value: 42 });
    assert.equal(
      store.db.prepare("SELECT 1 FROM secrets WHERE key LIKE 'msal:%'").get(),
      undefined,
    );
    assert.equal(
      store.db.prepare("SELECT 1 FROM kv WHERE key LIKE 'microsoft.%'").get(),
      undefined,
    );
    for (const name of ["chats", "messages", "suggestions", "approvals"])
      assert.equal(
        store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name),
        undefined,
      );
  }
  assert.equal(readFileSync(join(dir, "orbit.sqlite")).includes(Buffer.from("keep-pat")), false);
});

test("retired endpoints and tools are absent while memory confirmations remain usable", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-retired-api-")),
    store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const { app } = createApp(store);
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
  for (const path of ["/api/chats", "/api/inbox", "/api/approvals", "/api/connect/microsoft"])
    await request(app).get(path).set(auth).expect(404);
  for (const path of [
    "/api/chats/refresh",
    "/api/approvals",
    "/api/connect/microsoft",
    "/api/approvals/old/approve",
  ])
    await request(app).post(path).set(auth).send({}).expect(404);
  const names = makeTools(store, { client: "", project: "" }).map((tool) => tool.name);
  for (const name of ["list_chats", "read_teams_messages", "list_inbox", "propose_teams_message"])
    assert.ok(!names.includes(name));
  const settings = await request(app).get("/api/settings").set(auth).expect(200);
  for (const name of [
    "microsoftClientId",
    "microsoftTenantId",
    "teamsEnabled",
    "microsoftConnected",
  ])
    assert.ok(!(name in settings.body));
  await request(app).get("/api/memory-proposals").set(auth).expect(200);
  await request(app).get("/api/overview").set(auth).expect(200);
});
