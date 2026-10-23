import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { Agent, sessionConfig } from "../server/agent.js";
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

test("ticket list supports exact ID batches and literal title search together", async (t) => {
  const store = fixture(t);
  for (const [id, title] of [
    [1, "Feature UI"],
    [2, "Feature protocol"],
    [3, "Other"],
    [4, "100% literal"],
  ] as const)
    store.db
      .prepare("INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?,?)")
      .run(store.source(), id, title, "Active", "", "Bug", "", "", "now");
  const tool = sessionConfig(
    store,
    { client: "", project: "" },
  ).tools!.find((tool) => tool.name === "list_tickets")!;
  const list: any = await tool.handler!(
    { ids: [1, 3], search: "feature" },
    {} as any,
  );
  assert.deepEqual(
    list.tickets.map((ticket: any) => ticket.id),
    [1],
  );
  const literal: any = await tool.handler!({ search: "%" }, {} as any);
  assert.deepEqual(
    literal.tickets.map((ticket: any) => ticket.id),
    [4],
  );
});


test("summary ticket tool includes Azure dates without reading full content", async (t) => {
  const store = fixture(t);
  store.db.prepare("INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?,?)").run(
    store.source(), 42, "Example", "Active", "Alice", "Bug", "",
    "2026-10-20T10:00:00Z", "2026-10-21T11:00:00Z",
  );
  store.saveTicketCreatedAt(42, store.source(), "2026-09-01T09:00:00Z");
  const tool = sessionConfig(
    store,
    { client: "", project: "" },
  ).tools!.find((tool) => tool.name === "list_tickets")!;
  const result: any = await tool.handler!({ ids: [42], fields: ["created_at", "changed_at", "synced_at"] }, {} as any);
  assert.equal(result.tickets[0].created_at, "2026-09-01T09:00:00.000Z");
  assert.equal(result.tickets[0].changed_at, "2026-10-20T10:00:00Z");
  assert.equal(result.tickets[0].synced_at, "2026-10-21T11:00:00Z");
  assert.equal(result.tickets[0].description, undefined);
});


test("ticket summaries return only selected fields without changing filters", async (t) => {
  const { listLocalTickets, ticketListSchema } = await import("../server/ticket-list.js");
  const store = fixture(t);
  store.db.prepare("INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?,?)")
    .run(store.source(), 42, "Feature", "Active", "Alice", "Bug", "", "yesterday", "today");
  store.db.prepare("INSERT INTO ticket_metadata(source,id,notes,priority,tags) VALUES (?,?,?,?,?)")
    .run(store.source(), 42, "Private note", 2, JSON.stringify(["UI"]));
  const minimal = listLocalTickets(store, { tag: "UI", state: "Active" });
  assert.equal(minimal.total, 1);
  assert.deepEqual(minimal.tickets, [{ id: 42, title: "Feature" }]);
  const selected = listLocalTickets(store, { tag: "UI", fields: ["tags", "state"] });
  assert.deepEqual(selected.tickets, [{ id: 42, title: "Feature", state: "Active", tags: ["UI"] }]);
  assert.equal(selected.total, minimal.total);
  assert.equal(selected.nextAfterId, minimal.nextAfterId);
  const notes = listLocalTickets(store, { ids: [42], fields: ["notes"] });
  assert.equal(notes.tickets[0].notes, "Private note");
  assert.equal(notes.tickets[0].notesTruncated, undefined);
  assert.equal(ticketListSchema.safeParse({ fields: ["description"] }).success, false);
});
