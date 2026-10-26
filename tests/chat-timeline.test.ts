import test from "node:test";
import assert from "node:assert/strict";
import { updateChatTimeline, type ChatTimelineItem } from "../services/backend/src/chat-stream.js";
import { Store } from "../services/backend/src/store.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("stream preserves interleaved messages and tool position without duplicating complete events", () => {
  let items: ChatTimelineItem[] = [];
  items = updateChatTimeline(items, { stage: "text", messageId: "one", text: "Checking " });
  items = updateChatTimeline(items, { stage: "text", messageId: "one", text: "dev" });
  items = updateChatTimeline(items, {
    stage: "tool",
    toolId: "tool",
    name: "code_search",
    status: "running",
  });
  items = updateChatTimeline(items, { stage: "text", messageId: "two", text: "Found it" });
  items = updateChatTimeline(items, {
    stage: "tool",
    toolId: "tool",
    name: "code_search",
    status: "completed",
  });
  items = updateChatTimeline(items, {
    stage: "text",
    messageId: "two",
    text: "Found it",
    replace: true,
  });
  assert.deepEqual(
    items.map((item) => item.id),
    ["one", "tool", "two"],
  );
  assert.equal(items[0].kind === "text" && items[0].text, "Checking dev");
  assert.equal(items[1].kind === "tool" && items[1].tool.status, "completed");
});
test("timeline survives storage and is scoped to its chat", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "timeline-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const context = { client: "C", project: "P" };
  const session = store.chatSession(context);
  const timeline: ChatTimelineItem[] = [
    { kind: "text", id: "first", text: "Progress" },
    { kind: "text", id: "last", text: "Result" },
  ];
  store.say("assistant", "Result", context, [], session.id, 100, undefined, timeline);
  assert.deepEqual(JSON.parse((store.history(context, session.id)[0] as any).timeline), timeline);
});
