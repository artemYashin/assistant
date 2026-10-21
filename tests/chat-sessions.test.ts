import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, AppError } from "../server/store.js";
const context = { client: "Customer", project: "Project" };
function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-sessions-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return store;
}
test("legacy messages migrate once, retaining cards and chronological order", (t) => {
  const store = fixture(t);
  store.db
    .prepare(
      "INSERT INTO conversations (id,client,project,role,body,created_at,cards) VALUES (?,?,?,?,?,?,?)",
    )
    .run(
      "legacy",
      context.client,
      context.project,
      "assistant",
      "Existing response",
      "2026-10-01T00:00:00.000Z",
      '["card-ref"]',
    );
  const list = store.chatSessions(context);
  assert.equal(list.sessions.length, 1);
  assert.equal((store.history(context)[0] as any).cards, '["card-ref"]');
  assert.equal(store.chatSessions(context).activeId, list.activeId);
  assert.equal(store.chatSessions(context).sessions.length, 1);
});
test("chats isolate history, clear only the selected chat, and pin replies despite active switching", (t) => {
  const store = fixture(t);
  const first = store.activeChat(context);
  store.say("user", "First request", context, [], first.id);
  const second = store.createChat(context);
  assert.deepEqual(store.history(context), []);
  store.say("user", "Second request", context, [], second.id);
  store.say("assistant", "First answer", context, [], first.id);
  assert.deepEqual(
    store.history(context, first.id).map((r: any) => r.body),
    ["First request", "First answer"],
  );
  assert.deepEqual(
    store.history(context, second.id).map((r: any) => r.body),
    ["Second request"],
  );
  store.selectChat(context, first.id);
  assert.equal(store.chatSessions(context).activeId, first.id);
  assert.equal(store.clearHistory(context, second.id).deleted, 1);
  assert.equal(store.history(context, first.id).length, 2);
  assert.equal(store.chatSession(context, first.id).title, "First request");
  for (const action of [
    () => store.history({ ...context, project: "Other" }, first.id),
    () => store.selectChat({ ...context, project: "Other" }, first.id),
    () => store.clearHistory({ ...context, project: "Other" }, first.id),
  ]) {
    assert.throws(
      action,
      (error: any) => error instanceof AppError && error.status === 404,
    );
  }
});
test("UI pages retain older messages while model context stays limited", (t) => {
  const store = fixture(t),
    session = store.activeChat(context);
  for (let i = 0; i < 205; i++)
    store.say(i % 2 ? "assistant" : "user", String(i), context, [], session.id);
  const latest = store.conversationPage(context, session.id);
  assert.equal(latest.messages.length, 100);
  assert.equal(latest.messages[0].body, "105");
  assert.equal(latest.hasMore, true);
  const older = store.conversationPage(
    context,
    session.id,
    latest.messages[0].sequence,
  );
  const oldest = store.conversationPage(
    context,
    session.id,
    older.messages[0].sequence,
  );
  assert.equal(older.messages.length, 100);
  assert.equal(oldest.messages.length, 5);
  assert.equal(oldest.hasMore, false);
  assert.deepEqual(
    [...oldest.messages, ...older.messages, ...latest.messages].map(
      (r) => r.body,
    ),
    Array.from({ length: 205 }, (_, i) => String(i)),
  );
  assert.equal(store.history(context, session.id).length, 40);
});

test("consumed ticket attachment hides its badge but keeps chat context", t => {
  const store = fixture(t);
  const attachment = { id: 123, title: "Ticket", description: "Retained content" } as any;
  const session = store.createChat(context, attachment);
  assert.equal(store.chatAttachment(context, session.id, true)?.id, 123);
  store.markChatAttachmentSent(context, session.id);
  assert.equal(store.chatAttachment(context, session.id, true), null);
  assert.equal(store.chatAttachment(context, session.id)?.description, "Retained content");
  store.detachChatTicket(context, session.id);
  assert.equal(store.chatAttachment(context, session.id), null);
});
test("removing a pending ticket attachment leaves no content to send", t => {
  const store = fixture(t);
  const session = store.createChat(context, { id: 124, title: "Accidental attachment" } as any);
  store.detachChatTicket(context, session.id);
  assert.equal(store.chatAttachment(context, session.id, true), null);
  assert.equal(store.chatAttachment(context, session.id), null);
});
