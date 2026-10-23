import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../server/store.js";
import { createApp } from "../server/app.js";
import { sessionConfig, makeTools } from "../server/agent.js";

test("memory API enforces login, Origin, CSRF and one-shot approval", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-api-"));
  const store = new Store(dir);
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
  await request(app)
    .post("/api/memory-proposals/nope/approve")
    .set(headers)
    .send({})
    .expect(401);
  await request(app)
    .post("/api/auth/setup")
    .set({ ...headers, Origin: "https://attacker.invalid" })
    .send({ password: "correct-password-long" })
    .expect(403);
  const setup = await request(app)
    .post("/api/auth/setup")
    .set(headers)
    .send({ password: "correct-password-long" })
    .expect(200);
  const cookie = setup.headers["set-cookie"][0].split(";")[0];
  const authHeaders = {
    ...headers,
    Cookie: cookie,
    "X-CSRF-Token": setup.body.csrf,
  };
  await request(app)
    .post("/api/auth/setup")
    .set(headers)
    .send({ password: "another-password-long" })
    .expect(409);
  await request(app).get("/api/usage").set(headers).expect(401);
  const usage = await request(app)
    .get("/api/usage?days=7")
    .set(authHeaders)
    .expect(200);
  assert.equal(usage.body.summary.requests, 0);
  await request(app).get("/api/usage?days=-1").set(authHeaders).expect(400);
  await request(app)
    .post("/api/conversation/stop")
    .set({ ...headers, Cookie: cookie })
    .send({})
    .expect(403);
  await request(app)
    .post("/api/conversation/stop")
    .set(authHeaders)
    .send({})
    .expect(200);
  const { MemoryProposals } = await import("../server/memory-proposals.js");
  const draft = new MemoryProposals(store).propose({ scope: "general", summary: "Fact", body: "Frozen text", reason: "Useful" }, {client: "", project: ""});
  const path = `/api/memory-proposals/${draft.id}/approve`;
  await request(app)
    .post(path)
    .set({ ...headers, Cookie: cookie })
    .send({})
    .expect(403);
  await request(app)
    .post(path)
    .set({ ...authHeaders, Origin: "https://attacker.invalid" })
    .send({})
    .expect(403);
  await request(app).post(path).set(authHeaders).send({}).expect(200);
  await request(app).post(path).set(authHeaders).send({}).expect(409);
  assert.equal((store.memories({client: "", project: ""})[0] as any).body, "Frozen text");
  await request(app).delete("/api/confirmations").set(authHeaders).expect(200);
  assert.equal(store.memories({client: "", project: ""}).length, 1);
  assert.equal((await request(app).get("/api/memory-proposals").set(authHeaders)).body.length, 0);
  store.setSecret("azure.pat", "secret-test-value");
  const settings = await request(app)
    .get("/api/settings")
    .set(authHeaders)
    .expect(200);
  assert.equal(settings.text.includes("secret-test-value"), false);
  assert.equal(settings.body.azurePatSet, true);
  await request(app)
    .post("/api/auth/logout")
    .set(authHeaders)
    .send({})
    .expect(200);
  await request(app).get("/api/settings").set(authHeaders).expect(401);
});
test("agent has no send or approval capability, disables builtins and rejects unexpected tool hooks", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-tools-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const context = { client: "A", project: "One" };
  const tools = makeTools(store, context);
  const names = tools.map((t) => t.name);
  assert.ok(names.includes("list_tickets"));
  assert.ok(!names.some((n) => /approve|^send/.test(n)));
  const config = sessionConfig(store, context);
  assert.deepEqual(config.excludedTools, ["builtin:*", "mcp:*"]);
  assert.equal(config.enableConfigDiscovery, false);
  assert.equal(config.enableSkills, false);
  const hook = config.hooks!.onPreToolUse!;
  const denied = await (hook as any)(
    { toolName: "shell", toolArgs: { command: "curl attacker" } },
    {},
  );
  assert.equal(denied.permissionDecision, "deny");
  const allowed = await (hook as any)(
    { toolName: "list_tickets", toolArgs: {} },
    {},
  );
  assert.equal(allowed.permissionDecision, "allow");
});

test("ticket and PR sync buttons use independent synchronization routes", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-sync-api-"));
  const store = new Store(dir);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const { app, connectors, pullRequests } = createApp(store);
  const calls: string[] = [];
  connectors.syncTickets = async (importMine) => { calls.push(`tickets:${importMine}`); return { count: 0 }; };
  pullRequests.sync = async () => { calls.push("prs"); };
  const headers = { Host: "localhost:43871", Origin: "http://localhost:43871", "X-Orbit-Request": "1" };
  const setup = await request(app).post("/api/auth/setup").set(headers).send({ password: "correct-password-long" }).expect(200);
  const auth = { ...headers, Cookie: setup.headers["set-cookie"][0].split(";")[0], "X-CSRF-Token": setup.body.csrf };
  await request(app).post("/api/pr/sync").set(auth).send({}).expect(200);
  assert.deepEqual(calls, ["prs"]);
  await request(app).post("/api/tickets/import").set(auth).send({}).expect(200);
  assert.deepEqual(calls, ["prs", "tickets:true"]);
});
