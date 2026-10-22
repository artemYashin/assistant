import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { messageContextBadges } from "../server/chat-message-context.js";

const context = { client: "Customer", project: "Project" };
test("message badges deduplicate the analyzed ticket and snapshot concise memory titles", () => {
  const proposal = { id: "proposal", summary: "Original title", target_memory_id: "memory" };
  const badges = messageContextBadges({ analysis: { id: 42, source: "azure", title: "Ticket" }, viewed: { id: 42, source: "azure" }, proposal });
  proposal.summary = "Changed later";
  assert.deepEqual(badges.map(b => b.kind), ["analyze_ticket", "refine_memory"]);
  assert.equal(badges[1].title, "Original title");
  assert.equal(badges[1].savedMemory, true);
  assert.equal(messageContextBadges({ viewed: { id: 43, source: "azure" } })[0].kind, "viewed_ticket");
  assert.deepEqual(messageContextBadges({}), []);
});
test("message context survives reopening the database, pagination and chat switching", () => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-message-context-"));
  let store = new Store(dir);
  try {
    const session = store.activeChat(context);
    const badges = messageContextBadges({ analysis: { id: 42, source: store.source(), title: "Requirement" }, proposal: { id: "draft", summary: "Memory" }, viewed: { id: 43, source: store.source() } });
    store.say("user", "Analyze this", context, [], session.id, undefined, undefined, undefined, badges);
    store.say("assistant", "Response", context, [], session.id);
    store.close();
    store = new Store(dir);
    const page = store.conversationPage(context, session.id);
    assert.deepEqual(page.messages[0].message_context, badges);
    assert.equal(page.messages[0].body, "Analyze this");
    assert.equal(page.messages[1].message_context, undefined);
    assert.deepEqual(store.conversationPage(context, session.id, page.messages[1].sequence).messages[0].message_context, badges);
    const other = store.createChat(context);
    assert.equal(store.conversationPage(context, other.id).messages.length, 0);
    assert.deepEqual(store.conversationPage(context, session.id).messages[0].message_context, badges);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
