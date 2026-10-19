import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { createApp } from "../server/app.js";
import { Agent, mayManageLocalTicket } from "../server/agent.js";
import { Approvals } from "../server/approvals.js";
const context = { client: "A", project: "One" };
function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-chat-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return store;
}
test("clearing chat requires authentication/CSRF, isolates context and refuses active work", async (t) => {
  const store = fixture(t);
  const { app, agent } = createApp(store);
  const headers = {
    Host: "localhost:43871",
    Origin: "http://localhost:43871",
    "X-Orbit-Request": "1",
  };
  store.say("user", "current", context);
  store.say("assistant", "other", { ...context, project: "Two" });
  store.addMemory("general", "Keep this", context);
  await request(app)
    .delete("/api/conversation")
    .set(headers)
    .send(context)
    .expect(401);
  const setup = await request(app)
    .post("/api/auth/setup")
    .set(headers)
    .send({ password: "long-enough-password" })
    .expect(200);
  const auth = {
    ...headers,
    Cookie: setup.headers["set-cookie"][0].split(";")[0],
  };
  await request(app)
    .delete("/api/conversation")
    .set(auth)
    .send(context)
    .expect(403);
  const csrf = { ...auth, "X-CSRF-Token": setup.body.csrf };
  let busy = true;
  t.mock.method(agent, "active", () => (busy ? "running" : null));
  await request(app)
    .delete("/api/conversation")
    .set(csrf)
    .send(context)
    .expect(409);
  assert.equal(store.history(context).length, 1);
  busy = false;
  const cleared = await request(app)
    .delete("/api/conversation")
    .set(csrf)
    .send(context)
    .expect(200);
  assert.equal(cleared.body.deleted, 1);
  assert.equal(store.history(context).length, 0);
  assert.equal(store.history({ ...context, project: "Two" }).length, 1);
  assert.equal(store.memories(context).length, 1);
});
test("local tools add/remove/restore without Azure writes and deduplicate calls", async (t) => {
  const store = fixture(t);
  store.set("settings", {
    ...store.settings(),
    azureUrl: "https://ado.test/org",
    azureProject: "P",
  });
  store.setSecret("azure.pat", "pat");
  const { connectors } = createApp(store);
  const requests: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: any, init: any) => {
    requests.push(`${init.method || "GET"} ${url}`);
    assert.equal(init.method || "GET", "GET");
    assert.match(String(url), /\/workitems\/42\?/);
    return new Response(
      JSON.stringify({
        id: 42,
        fields: {
          "System.TeamProject": "P",
          "System.Title": "Ticket",
          "System.State": "Active",
          "System.WorkItemType": "Bug",
        },
      }),
    );
  });
  let config: any,
    action = "add";
  const session = {
    on: () => {},
    abort: async () => {},
    destroy: async () => {},
    sendAndWait: async () => {
      const tool = config.tools.find(
        (tool: any) => tool.name === `${action}_local_ticket`,
      );
      const first = await tool.handler({ id: 42 }, {});
      assert.equal(first.azureChanged, false);
      assert.equal(first.success, true);
      assert.deepEqual(await tool.handler({ id: 42 }, {}), first);
      await assert.rejects(tool.handler({ id: 43 }, {}), /явная команда/);
      return { data: { content: "Done locally" } };
    },
  };
  const client = {
    start: async () => {},
    stop: async () => {},
    createSession: async (c: any) => {
      config = c;
      return session;
    },
  };
  const agent = new Agent(
    store,
    new Approvals(store, async () => ({ id: "unused" })),
    () => client as any,
    connectors,
  );
  await agent.chat("Добавь 42 в локальный трекер", context);
  assert.equal(requests.length, 1);
  assert.equal(
    (store.db.prepare("SELECT state FROM tickets WHERE id=42").get() as any)
      .state,
    "Active",
  );
  action = "remove";
  await agent.chat("Убери 42 из локального списка", context);
  assert.equal(requests.length, 1);
  assert.equal(
    store.db.prepare("SELECT 1 FROM tickets WHERE id=42").get(),
    undefined,
  );
  assert.equal(
    (
      store.db
        .prepare("SELECT removed FROM ticket_local WHERE id=42")
        .get() as any
    ).removed,
    1,
  );
  action = "add";
  await agent.chat("Добавь 42 в трекер", context);
  assert.equal(requests.length, 2);
  assert.equal(
    (
      store.db
        .prepare("SELECT removed FROM ticket_local WHERE id=42")
        .get() as any
    ).removed,
    0,
  );
});
test("local mutation intent rejects negative requests and missing ID/action", () => {
  assert.equal(mayManageLocalTicket("Не удаляй 42", 42, "remove"), false);
  assert.equal(mayManageLocalTicket("Покажи 42", 42, "add"), false);
  assert.equal(mayManageLocalTicket("Добавь 142", 42, "add"), false);
  assert.equal(
    mayManageLocalTicket("Удалить тикет 42 из списка", 42, "remove"),
    true,
  );
});
