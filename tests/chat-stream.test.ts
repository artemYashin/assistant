import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, AppError } from "../server/store.js";
import { createApp } from "../server/app.js";

test("conversation streams text and tool progress with a final result or terminal error", async t => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-chat-stream-"));
  const store = new Store(dir);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const { app, agent } = createApp(store);
  const headers = { Host: "localhost:43871", Origin: "http://localhost:43871", "X-Orbit-Request": "1" };
  const setup = await request(app).post("/api/auth/setup").set(headers).send({ password: "correct-password-long" }).expect(200);
  const auth = { ...headers, Cookie: setup.headers["set-cookie"][0].split(";")[0], "X-CSRF-Token": setup.body.csrf };
  const body = { prompt: "Привет", context: { client: "", project: "" } };
  let fail = false;
  agent.chat = async (_prompt, _context, _review, _actions, _session, _model, report) => {
    report?.({ stage: "text", messageId: "m1", text: "Привет" });
    report?.({ stage: "tool", toolId: "t1", name: "list_local_tags", status: "running" });
    report?.({ stage: "tool", toolId: "t1", name: "list_local_tags", status: "completed" });
    if (fail) throw new AppError(409, "Остановлено пользователем");
    return { body: "Привет!", requestId: "00000000-0000-4000-8000-000000000001", cards: [], durationMs: 25 };
  };
  const streamed = await request(app).post("/api/conversation").set({ ...auth, Accept: "application/x-ndjson" }).send(body).expect(200);
  const events = streamed.text.trim().split("\n").map(line => JSON.parse(line));
  assert.equal(events[0].progress.text, "Привет");
  assert.equal(events[1].progress.status, "running");
  assert.equal(events[2].progress.status, "completed");
  assert.deepEqual(events.at(-1), { type: "result", data: { body: "Привет!", requestId: "00000000-0000-4000-8000-000000000001", cards: [], durationMs: 25 } });
  const buffered = await request(app).post("/api/conversation").set(auth).send(body).expect(200);
  assert.equal(buffered.body.body, "Привет!");
  fail = true;
  const stopped = await request(app).post("/api/conversation").set({ ...auth, Accept: "application/x-ndjson" }).send(body).expect(200);
  const terminal = JSON.parse(stopped.text.trim().split("\n").at(-1)!);
  assert.deepEqual(terminal, { type: "error", error: "Остановлено пользователем" });
});

test("assistant duration survives history reads without changing legacy messages", t => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-chat-duration-"));
  const store = new Store(dir);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const context = { client: "", project: "" };
  store.say("user", "Привет", context);
  store.say("assistant", "Готово", context, [], undefined, 12345);
  const messages = store.conversationPage(context).messages;
  assert.equal(messages.at(-2).duration_ms, null);
  assert.equal(messages.at(-1).duration_ms, 12345);
});
