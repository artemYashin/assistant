import { withToolDiscovery } from "./sdk-discovery-helper.js";
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
      const denied = await tool.handler({ id: 43 }, {});
      assert.equal(denied.success, false);
      assert.match(denied.error, /явная команда/);
      return { data: { content: "Done locally" } };
    },
  };
  const client = {
    start: async () => {},
    stop: async () => {},
    createSession: async (c: any) => {
      config = c;
      return withToolDiscovery(c, session);
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

test("chat receives selected ticket IDs and rejects stale Azure selection", async (t) => {
  const store = fixture(t);
  const { app, agent } = createApp(store);
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
  const prompts: string[] = [];
  t.mock.method(agent, "chat", async (prompt: string) => {
    prompts.push(prompt);
    return { body: "OK", cards: [] };
  });
  const post = (selectedTickets?: unknown) =>
    request(app)
      .post("/api/conversation")
      .set(auth)
      .send({ prompt: "Расскажи о выбранных", context, selectedTickets });
  await post([
    { id: 42, source: store.source() },
    { id: 42, source: store.source() },
  ]).expect(200);
  assert.equal((prompts[0].match(/#42/g) || []).length, 1);
  assert.match(prompts[0], /сам выбор не является просьбой изменить/);
  await post([{ id: 42, source: "other-organization" }]).expect(409);
  assert.equal(prompts.length, 1);
  await post().expect(200);
  assert.equal(prompts[1], "Расскажи о выбранных");
});

test("deleting a chat isolates context, clears runtime and selects a remaining or new chat", t => {
  const store = fixture(t);
  const first = store.createChat(context);
  const second = store.createChat(context);
  const foreign = store.createChat({ ...context, project: 'Other' });
  store.say('user', 'Keep first', context, [], first.id);
  store.say('user', 'Delete second', context, [], second.id);
  store.set(`chat.runtime:${second.id}`, { secret: 'history' });
  store.set(`chat.context:${second.id}`, { currentTokens: 12 });
  assert.throws(() => store.deleteChat(context, foreign.id), /Чат не найден/);
  const result = store.deleteChat(context, second.id);
  assert.equal(result.activeId, first.id);
  assert.equal(result.sessions.length, 1);
  assert.equal((store.history(context, first.id)[0] as any).body, 'Keep first');
  assert.equal((store.db.prepare('SELECT COUNT(*) AS n FROM conversations WHERE session_id=?').get(second.id) as any).n, 0);
  assert.equal(store.get(`chat.runtime:${second.id}`, 'missing'), 'missing');
  assert.equal(store.get(`chat.context:${second.id}`, 'missing'), 'missing');
  assert.throws(() => store.chatSession(context, second.id), /Чат не найден/);
  assert.equal(store.chatSession({ ...context, project: 'Other' }, foreign.id).id, foreign.id);
  const empty = store.deleteChat(context, first.id);
  assert.notEqual(empty.activeId, first.id);
  assert.equal(empty.sessions.length, 1);
  assert.equal((empty.sessions[0] as any).messageCount, 0);
});

test("delete session API requires auth, CSRF and idle assistant", async t => {
  const store = fixture(t);
  const { app, agent } = createApp(store);
  const session = store.createChat(context);
  const url = `/api/conversation/sessions/${session.id}`;
  const headers = { Host: 'localhost:43871', Origin: 'http://localhost:43871', 'X-Orbit-Request': '1' };
  await request(app).delete(url).set(headers).send(context).expect(401);
  const setup = await request(app).post('/api/auth/setup').set(headers).send({ password: 'long-enough-password' }).expect(200);
  const auth = { ...headers, Cookie: setup.headers['set-cookie'][0].split(';')[0] };
  await request(app).delete(url).set(auth).send(context).expect(403);
  const csrf = { ...auth, 'X-CSRF-Token': setup.body.csrf };
  let busy = true;
  t.mock.method(agent, 'active', () => busy ? 'running' : null);
  await request(app).delete(url).set(csrf).send(context).expect(409);
  busy = false;
  await request(app).delete(url).set(csrf).send({ ...context, project: 'Other' }).expect(404);
  const result = await request(app).delete(url).set(csrf).send(context).expect(200);
  assert.notEqual(result.body.activeId, session.id);
  await request(app).delete(url).set(csrf).send(context).expect(404);
});

test("explicit import and restore commands authorize only requested ticket IDs", () => {
  for (const prompt of ["Импортируй тикеты #42, #43", "Импортировать 42 и 43", "Import tickets 42, 43", "Восстанови тикеты 42, 43", "Импортируйте https://dev.azure.com/org/project/_workitems/edit/42 и #43"]) {
    assert.equal(mayManageLocalTicket(prompt, 42, "add"), true, prompt);
    assert.equal(mayManageLocalTicket(prompt, 43, "add"), true, prompt);
    assert.equal(mayManageLocalTicket(prompt, 99, "add"), false, prompt);
  }
  for (const prompt of ["Не импортируй 42", "Не восстанавливай 42", "Do not import 42", "Покажи тикет 42"]) {
    assert.equal(mayManageLocalTicket(prompt, 42, "add"), false, prompt);
  }
});
