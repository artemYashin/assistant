import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, AppError } from "../services/backend/src/store.js";
import { createApp } from "../services/backend/src/app.js";

test("conversation streams text and tool progress with a final result or terminal error", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-chat-stream-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const { app, agent } = createApp(store);
  const headers = {
    Host: "localhost:43871",
    Origin: "http://localhost:43871",
    "X-Orbit-Request": "1",
  };
  const setup = await request(app)
    .post("/api/auth/setup")
    .set(headers)
    .send({ password: "correct-password-long" })
    .expect(200);
  const auth = {
    ...headers,
    Cookie: setup.headers["set-cookie"][0].split(";")[0],
    "X-CSRF-Token": setup.body.csrf,
  };
  const body = { prompt: "Привет", context: { client: "", project: "" } };
  let fail = false;
  agent.chat = async (_prompt, _context, _review, _actions, _session, _model, report) => {
    report?.({ stage: "text", messageId: "m1", text: "Привет" });
    report?.({ stage: "tool", toolId: "t1", name: "list_local_tags", status: "running" });
    report?.({ stage: "tool", toolId: "t1", name: "list_local_tags", status: "completed" });
    if (fail) throw new AppError(409, "Остановлено пользователем");
    return {
      body: "Привет!",
      requestId: "00000000-0000-4000-8000-000000000001",
      cards: [],
      durationMs: 25,
    };
  };
  const streamed = await request(app)
    .post("/api/conversation")
    .set({ ...auth, Accept: "application/x-ndjson" })
    .send(body)
    .expect(200);
  const events = streamed.text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(events[0].progress.text, "Привет");
  assert.equal(events[1].progress.status, "running");
  assert.equal(events[2].progress.status, "completed");
  assert.deepEqual(events.at(-1), {
    type: "result",
    data: {
      body: "Привет!",
      requestId: "00000000-0000-4000-8000-000000000001",
      cards: [],
      durationMs: 25,
    },
  });
  const buffered = await request(app).post("/api/conversation").set(auth).send(body).expect(200);
  assert.equal(buffered.body.body, "Привет!");
  fail = true;
  const stopped = await request(app)
    .post("/api/conversation")
    .set({ ...auth, Accept: "application/x-ndjson" })
    .send(body)
    .expect(200);
  const terminal = JSON.parse(stopped.text.trim().split("\n").at(-1)!);
  assert.deepEqual(terminal, { type: "error", error: "Остановлено пользователем" });
});

test("assistant duration survives history reads without changing legacy messages", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-chat-duration-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const context = { client: "", project: "" };
  store.say("user", "Привет", context);
  store.say("assistant", "Готово", context, [], undefined, 12345);
  const messages = store.conversationPage(context).messages;
  assert.equal(messages.at(-2).duration_ms, null);
  assert.equal(messages.at(-1).duration_ms, 12345);
});

test("tool history and token usage persist in the correct chat with selective discovery", async (t) => {
  const { Agent } = await import("../services/backend/src/agent.js");
  const { UsageLedger } = await import("../services/backend/src/usage.js");
  const dir = mkdtempSync(join(tmpdir(), "orbit-chat-traces-"));
  let store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const context = { client: "Customer", project: "Project" };
  const first = store.createChat(context),
    second = store.createChat(context);
  const handlers = new Map<string, (event: any) => void>();
  let tools: any[] = [];
  const client = {
    start: async () => {},
    stop: async () => {},
    createSession: async (config: any) => {
      assert.deepEqual(
        config.tools.map((tool: any) => tool.name),
        ["load_tools"],
      );
      tools = config.tools;
      return {
        on: (name: string, handler: (event: any) => void) => {
          handlers.set(name, handler);
        },
        abort: async () => {},
        setTools: async (loaded: any[]) => {
          tools = loaded;
        },
        sendAndWait: async () => {
          await tools[0].handler({ names: ["list_local_tags"] }, {});
          assert.deepEqual(
            tools.map((tool) => tool.name),
            ["load_tools", "list_local_tags"],
          );
          await tools[1].handler({ offset: 0 }, {});
          const usage = {
            id: "event",
            data: { inputTokens: 123, outputTokens: 45, apiCallId: "one-call" },
          };
          handlers.get("assistant.usage")!(usage);
          handlers.get("assistant.usage")!(usage);
          return { data: { content: "Тегов пока нет." } };
        },
      };
    },
  };
  const agent = new Agent(store, () => client as any);
  const events: any[] = [];
  await agent.chat(
    "Покажи локальные теги",
    context,
    false,
    undefined,
    first.id,
    undefined,
    (event) => events.push(event),
  );
  assert.equal(events.find((event) => event.stage === "usage").inputTokens, 123);
  store.close();
  store = new Store(dir);
  const page = store.conversationPage(context, first.id);
  const reply = page.messages.at(-1);
  assert.deepEqual(
    reply.tools.map((tool: any) => tool.name),
    ["load_tools", "list_local_tags"],
  );
  assert.deepEqual(reply.tools[0].names, ["list_local_tags"]);
  assert.ok(
    reply.tools.every(
      (tool: any) => tool.status === "completed" && tool.durationMs >= 0 && tool.offsetMs >= 0,
    ),
  );
  const ledger = new UsageLedger(store);
  assert.deepEqual(ledger.sessionUsage(context, first.id), {
    inputTokens: 123,
    outputTokens: 45,
    reports: 1,
    partial: false,
    contextUsage: null,
  });
  assert.deepEqual(ledger.sessionUsage(context, second.id), {
    inputTokens: 0,
    outputTokens: 0,
    reports: 0,
    partial: false,
    contextUsage: null,
  });
  assert.equal(store.conversationPage(context, second.id).messages.length, 0);
  assert.throws(() => ledger.sessionUsage({ client: "Other", project: "" }, first.id));
  store.say("assistant", "Старая переписка", context, [], second.id);
  assert.equal(ledger.sessionUsage(context, second.id).partial, true);
  const receiptsBefore = store.db.prepare("SELECT count(*) AS count FROM llm_usage").get();
  store.clearHistory(context, first.id);
  assert.deepEqual(ledger.sessionUsage(context, first.id), {
    inputTokens: 0,
    outputTokens: 0,
    reports: 0,
    partial: false,
    contextUsage: null,
  });
  assert.deepEqual(
    store.db.prepare("SELECT count(*) AS count FROM llm_usage").get(),
    receiptsBefore,
  );
  assert.equal(ledger.sessionUsage(context, second.id).partial, true);
});
