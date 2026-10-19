import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../server/store.js";
import { createApp } from "../server/app.js";
import { sessionConfig, makeTools } from "../server/agent.js";
import { Approvals } from "../server/approvals.js";

test("sending API enforces login, Origin, CSRF, immutable payload and one-shot approval", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-api-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const sent: any[] = [];
  const { app } = createApp(store, {
    sendMessage: async (id, body) => {
      sent.push({ id, body });
      return { id: "remote" };
    },
  });
  store.db
    .prepare("INSERT INTO chats(id,name) VALUES (?,?)")
    .run("chat-1", "Team");
  const headers = {
    Host: "localhost:3000",
    Origin: "http://localhost:3000",
    "X-Orbit-Request": "1",
  };
  await request(app)
    .post("/api/approvals/nope/approve")
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
  const draft = await request(app)
    .post("/api/approvals")
    .set(authHeaders)
    .send({ chatId: "chat-1", body: "Frozen text" })
    .expect(200);
  assert.equal(sent.length, 0);
  const path = `/api/approvals/${draft.body.id}/approve`;
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
  await request(app)
    .post(path)
    .set(authHeaders)
    .send({ body: "Changed text", chatId: "attacker" })
    .expect(400);
  await request(app).post(path).set(authHeaders).send({}).expect(200);
  await request(app).post(path).set(authHeaders).send({}).expect(409);
  assert.deepEqual(sent, [{ id: "chat-1", body: "Frozen text" }]);
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
  const approvals = new Approvals(store, async () => {
    throw new Error("never");
  });
  const context = { client: "A", project: "One" };
  const tools = makeTools(store, approvals, context);
  const names = tools.map((t) => t.name);
  assert.ok(names.includes("propose_teams_message"));
  assert.ok(!names.some((n) => /approve|^send/.test(n)));
  const config = sessionConfig(store, approvals, context);
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
