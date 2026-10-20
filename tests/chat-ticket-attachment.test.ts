import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { Agent } from "../server/agent.js";
import { Approvals } from "../server/approvals.js";
import {
  ticketAnalysisAttachment,
  attachmentPreview,
} from "../server/chat-ticket-attachment.js";
const context = { client: "C", project: "P" };
function card(source: string) {
  return {
    id: 42,
    source,
    url: "https://ado.test/_workitems/edit/42",
    loadedAt: "2026-10-20T00:00:00Z",
    fields: {
      "System.Title": "Analysis target",
      "System.Description": "<p>Description</p>",
      "Microsoft.VSTS.Common.AcceptanceCriteria": "<b>Acceptance</b>",
      "Microsoft.VSTS.TCM.ReproSteps": "Steps",
    },
    comments: [
      {
        author: "Author",
        date: "2026-10-20",
        text: "x".repeat(55000) + "LAST_COMMENT",
      },
    ],
    attachments: [],
    warnings: ["Some images are not available"],
  };
}
function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-chat-attachment-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return store;
}
test("ticket analysis snapshot retains full text and comments, is scoped and clears with its chat", (t) => {
  const store = fixture(t);
  const attachment = ticketAnalysisAttachment(
    card(store.source()),
    store.source(),
  );
  assert.equal(attachment.description, "Description");
  assert.equal(attachment.acceptanceCriteria, "Acceptance");
  assert.ok(attachment.comments[0].text.endsWith("LAST_COMMENT"));
  const session = store.createChat(context, attachment);
  assert.deepEqual(store.chatAttachment(context, session.id), attachment);
  assert.equal(attachmentPreview(attachment)?.comments, 1);
  assert.ok(
    !JSON.stringify(store.chatSessions(context)).includes("LAST_COMMENT"),
  );
  const other = store.createChat(context);
  assert.equal(store.chatAttachment(context, other.id), null);
  assert.throws(() =>
    store.chatAttachment({ ...context, project: "Other" }, session.id),
  );
  store.clearHistory(context, session.id);
  assert.equal(store.chatAttachment(context, session.id), null);
});
test("analysis rejects mismatched sources and oversized snapshots without truncating", () => {
  assert.throws(
    () => ticketAnalysisAttachment(card("old"), "current"),
    /Подключение Azure/,
  );
  const huge = card("source");
  huge.comments[0].text = "x".repeat(200001);
  assert.throws(() => ticketAnalysisAttachment(huge, "source"), /200 000/);
});
test("agent receives attached criteria and full comments without Azure or another chat history", async (t) => {
  const store = fixture(t);
  const other = store.createChat(context);
  store.say("user", "OTHER_CHAT_SECRET", context, [], other.id);
  const session = store.createChat(
    context,
    ticketAnalysisAttachment(card(store.source()), store.source()),
  );
  let sent = "";
  const sdkSession = {
    on: () => {},
    abort: async () => {},
    destroy: async () => {},
    sendAndWait: async (args: any) => {
      sent = args.prompt;
      return { data: { content: "Analysis ready" } };
    },
  };
  const client = {
    start: async () => {},
    stop: async () => {},
    createSession: async () => sdkSession,
  };
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Unexpected remote call");
  });
  const agent = new Agent(
    store,
    new Approvals(store, async () => ({ id: "unused" })),
    () => client as any,
  );
  const result = await agent.chat(
    "Проанализируй тикет #42",
    context,
    false,
    undefined,
    session.id,
  );
  assert.equal(result.body, "Analysis ready");
  assert.ok(sent.includes("LAST_COMMENT"));
  assert.ok(sent.includes("Acceptance"));
  assert.ok(sent.includes("Steps"));
  assert.ok(!sent.includes("OTHER_CHAT_SECRET"));
  assert.equal(store.history(context, other.id).length, 1);
  assert.equal(store.history(context, session.id).length, 2);
});

test("detaching a ticket preserves chat messages and other session attachments", (t) => {
  const store = fixture(t);
  const attachment = ticketAnalysisAttachment(
    card(store.source()),
    store.source(),
  );
  const first = store.createChat(context, attachment);
  const other = store.createChat(context, attachment);
  store.say("user", "Analyze the requirements", context, [], first.id);
  store.say("assistant", "Saved response", context, [], first.id);
  assert.throws(
    () => store.detachChatTicket({ client: "Other", project: "P" }, first.id),
    /Чат не найден/,
  );
  store.detachChatTicket(context, first.id);
  assert.equal(store.chatAttachment(context, first.id), null);
  assert.equal(store.history(context, first.id).length, 2);
  assert.equal(store.chatAttachment(context, other.id)?.id, attachment.id);
  store.detachChatTicket(context, first.id);
  assert.equal(store.chatAttachment(context, first.id), null);
});
