import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { Agent, sessionConfig } from "../server/agent.js";
import { Approvals } from "../server/approvals.js";
function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-list-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return store;
}
test("ticket tool pages beyond 100 with filters, bounded responses and source isolation", async (t) => {
  const store = fixture(t);
  const insert = store.db.prepare(
    "INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?,?)",
  );
  for (let id = 1; id <= 250; id++)
    insert.run(
      store.source(),
      id,
      "x".repeat(1000),
      "Active",
      "A",
      "Bug",
      "url".repeat(10000),
      "",
      "today",
    );
  insert.run(
    store.source(),
    251,
    "Other type",
    "Active",
    "A",
    "Task",
    "",
    "",
    "",
  );
  insert.run(
    "other-source",
    252,
    "Other source",
    "Active",
    "A",
    "Bug",
    "",
    "",
    "",
  );
  const tool = sessionConfig(
    store,
    new Approvals(store, async () => ({ id: "unused" })),
    { client: "", project: "" },
  ).tools!.find((t) => t.name === "list_tickets")!;
  let afterId = 0;
  const ids: number[] = [];
  for (let page = 0; page < 20; page++) {
    const result: any = await tool.handler!(
      { type: "bug", state: "active", afterId },
      {} as any,
    );
    assert.equal(result.total, 250);
    assert.equal(result.truncated, undefined);
    assert.ok(JSON.stringify(result).length < 24000);
    ids.push(...result.tickets.map((t: any) => t.id));
    assert.deepEqual(result.tickets[0].shortenedFields, ["title"]);
    if (!result.hasMore) break;
    assert.ok(result.nextAfterId > afterId);
    afterId = result.nextAfterId;
  }
  assert.deepEqual(
    ids,
    Array.from({ length: 250 }, (_, i) => i + 1),
  );
  const empty: any = await tool.handler!({ state: "Missing" }, {} as any);
  assert.equal(empty.total, 0);
  assert.equal(empty.nextAfterId, null);
});
test("chat and review use separate models and record the selection, with legacy fallback", async (t) => {
  const store = fixture(t);
  const models: string[] = [];
  store.set("settings", {
    ...store.settings(),
    model: "chat-model",
    reviewModel: "review-model",
  });
  const agent = new Agent(
    store,
    new Approvals(store, async () => ({ id: "unused" })),
    () =>
      ({
        start: async () => {},
        stop: async () => {},
        createSession: async (config: any) => {
          models.push(config.model);
          return {
            on: () => {},
            destroy: async () => {},
            sendAndWait: async () => ({ data: { content: "Done" } }),
          };
        },
      }) as any,
  );
  const context = { client: "", project: "" };
  await agent.chat("Hello", context);
  await agent.chat("Review", context, true);
  store.set("settings", { ...store.settings(), reviewModel: "" });
  await agent.chat("Review", context, true);
  assert.deepEqual(models, ["chat-model", "review-model", "chat-model"]);
  const rows = store.db
    .prepare("SELECT model FROM llm_requests ORDER BY rowid")
    .all() as any[];
  assert.deepEqual(
    rows.map((r) => r.model),
    models,
  );
});
