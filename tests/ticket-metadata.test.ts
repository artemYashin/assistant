import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import {
  ticketMetadata,
  saveTicketMetadata,
  priorityCount,
} from "../server/ticket-metadata.js";
import { listLocalTickets } from "../server/ticket-list.js";
function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-metadata-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  store.db
    .prepare(
      "INSERT INTO tickets VALUES (?,42,'Bug','Active','','Bug','','','')",
    )
    .run(store.source());
  return store;
}
const context = { client: "Client", project: "Project" };
test("local metadata is independent, validates priorities, merges fields, and filters chat lists", (t) => {
  const store = fixture(t);
  assert.equal(ticketMetadata(store, 42).priority, 1);
  assert.equal(priorityCount(store, context), 3);
  store.set('ticket-priorities:["Client",""]', 5);
  assert.equal(priorityCount(store, context), 5);
  store.set('ticket-priorities:["Client","Project"]', 4);
  assert.equal(priorityCount(store, context), 4);
  saveTicketMetadata(store, 42, store.source(), context, {
    notes: "Ready for retest",
    tags: ["UI", "UI", "Bug"],
    priority: 4,
  });
  saveTicketMetadata(store, 42, store.source(), context, {
    notes: "Not ready",
  });
  assert.deepEqual(ticketMetadata(store, 42), {
    notes: "Not ready",
    tags: ["UI", "Bug"],
    priority: 4,
  });
  assert.throws(() =>
    saveTicketMetadata(store, 42, store.source(), context, { priority: 5 }),
  );
  assert.throws(() =>
    saveTicketMetadata(store, 42, "other", context, { notes: "No" }),
  );
  assert.throws(() =>
    saveTicketMetadata(store, 99, store.source(), context, { notes: "No" }),
  );
  assert.equal(listLocalTickets(store, { priority: 4, tag: "ui" }).total, 1);
  assert.equal(listLocalTickets(store, { priority: 2 }).total, 0);
  assert.equal(
    listLocalTickets(store, { tag: "UI" }).tickets[0].notes,
    "Not ready",
  );
  store.db.prepare("UPDATE tickets SET state='Resolved' WHERE id=42").run();
  assert.equal(ticketMetadata(store, 42).priority, 4);
  assert.equal(ticketMetadata(store, 42, "other").priority, 1);
});
test("trash retains metadata until expiry and restores it", (t) => {
  const store = fixture(t);
  saveTicketMetadata(store, 42, store.source(), context, {
    notes: "Remember",
    priority: 1,
    tags: ["urgent"],
  });
  store.removeLocalTicket(42);
  assert.equal(store.ticketTrash()[0].notes, "Remember");
  store.restoreLocalTicket(42);
  assert.equal(ticketMetadata(store, 42).priority, 1);
  store.removeLocalTicket(42);
  store.purgeTicketTrash(Date.now() + 31 * 86400000);
  assert.deepEqual(ticketMetadata(store, 42), {
    notes: "",
    priority: 1,
    tags: [],
  });
});

test("chat metadata edits are local, preserve other fields and deduplicate append", async (t) => {
  const { ticketMetadataTools } =
    await import("../server/ticket-metadata-tools.js");
  const store = fixture(t);
  saveTicketMetadata(store, 42, store.source(), context, {
    notes: "Before",
    tags: ["API"],
    priority: 2,
  });
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("No network allowed");
  });
  const tool = ticketMetadataTools(
    store,
    context,
    "Добавь заметку «Ready» и тег UI тикету 42, поставь приоритет 1",
    () => {},
  )[0];
  const args = {
    id: 42,
    notes: { mode: "append" as const, text: "Ready" },
    tags: { mode: "add" as const, values: ["UI"] },
    priority: 1,
  };
  const first: any = await tool.handler!(args, {} as any);
  await tool.handler!(args, {} as any);
  assert.equal(first.success, true);
  assert.equal(first.azureChanged, false);
  assert.deepEqual(ticketMetadata(store, 42), {
    notes: "Before\n\nReady",
    tags: ["API", "UI"],
    priority: 1,
  });
  await assert.rejects(async () =>
    tool.handler!(
      { ...args, notes: { mode: "append", text: "Different" } },
      {} as any,
    ),
  );
});
test("chat metadata validates priority limits and source without parsing the confirmation", async (t) => {
  const { ticketMetadataTools } = await import("../server/ticket-metadata-tools.js");
  const store = fixture(t);
  const tool = ticketMetadataTools(store, context, "Да, давай", () => {})[0];
  await assert.rejects(async () => tool.handler!({ id: 42, priority: 4 }, {} as any), /Приоритет/);
  store.set("settings", { ...store.settings(), azureProject: "Changed" });
  await assert.rejects(async () => tool.handler!({ id: 42, priority: 1 }, {} as any), /Подключение/);
});
test("chat tag removal and explicit notes clearing preserve unrelated metadata", async (t) => {
  const { ticketMetadataTools } =
    await import("../server/ticket-metadata-tools.js");
  const store = fixture(t);
  saveTicketMetadata(store, 42, store.source(), context, {
    notes: "Old",
    tags: ["UI", "API"],
    priority: 1,
  });
  const tool = ticketMetadataTools(
    store,
    context,
    "Удали тег UI и очисти заметки тикета 42",
    () => {},
  )[0];
  await tool.handler!(
    {
      id: 42,
      tags: { mode: "remove", values: ["UI"] },
      notes: { mode: "clear" },
    },
    {} as any,
  );
  assert.deepEqual(ticketMetadata(store, 42), {
    notes: "",
    tags: ["API"],
    priority: 1,
  });
});

test("priority migration preserves old implicit P2 and explicit values while new tickets default to P1", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-priority-migration-"));
  let store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const source = store.source();
  store.db
    .prepare("DELETE FROM kv WHERE key='migration.ticketPriorityOne'")
    .run();
  store.db
    .prepare(
      "INSERT INTO tickets VALUES (?,42,'Existing','Active','','Bug','','','')",
    )
    .run(source);
  store.db
    .prepare(
      "INSERT INTO tickets VALUES (?,43,'Explicit','Active','','Bug','','','')",
    )
    .run(source);
  saveTicketMetadata(store, 43, source, context, {
    priority: 3,
    notes: "Keep",
  });
  store.close();
  store = new Store(dir);
  assert.equal(ticketMetadata(store, 42).priority, 2);
  assert.equal(ticketMetadata(store, 43).priority, 3);
  assert.equal(ticketMetadata(store, 43).notes, "Keep");
  store.db
    .prepare(
      "INSERT INTO tickets VALUES (?,44,'New','Active','','Bug','','','')",
    )
    .run(source);
  assert.equal(ticketMetadata(store, 44).priority, 1);
  assert.equal(listLocalTickets(store, { priority: 1 }).total, 1);
});

test("chat metadata accepts historical IDs and values without rereading and stays local", async (t) => {
  const { ticketMetadataTools } = await import("../server/ticket-metadata-tools.js");
  const store = fixture(t);
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Must stay local"); });
  const tool = ticketMetadataTools(store, context, "Да, давай", () => {})[0];
  const result: any = await tool.handler!({ id: 42, tags: { mode: "add", values: ["Inside 2"] }, notes: { mode: "append", text: "Ready" }, priority: 2 }, {} as any);
  assert.equal(result.success, true);
  assert.deepEqual(ticketMetadata(store, 42), { tags: ["Inside 2"], notes: "Ready", priority: 2 });
  await assert.rejects(async () => tool.handler!({ id: 999, tags: { mode: "add", values: ["Inside 2"] } }, {} as any), /отсутствует/);
});

test("chat metadata tool reports actionable validation errors instead of generic SDK failure", async (t) => {
  const { ticketMetadataTools } =
    await import("../server/ticket-metadata-tools.js");
  const { sessionConfig } = await import("../server/agent.js");
  const store = fixture(t);
  const logs: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => {
    logs.push(args);
  });
  const config = sessionConfig(
    store,
    {} as any,
    context,
    undefined,
    undefined,
    undefined,
    undefined,
    ticketMetadataTools(store, context, "Добавь тег UI тикету 999", () => {}),
  );
  const tool = config.tools!.find(
    (t) => t.name === "update_local_ticket_metadata",
  )!;
  const result: any = await tool.handler!(
    { id: 999, tags: { mode: "add", values: ["UI"] } },
    {} as any,
  );
  assert.equal(result.success, false);
  assert.match(result.error, /отсутствует в локальном списке/);
  assert.ok(result.reference);
  assert.equal(result.azureChanged, false);
  const invalid: any = await tool.handler!(
    { id: 999, tags: ["UI"] },
    {} as any,
  );
  assert.equal(invalid.success, false);
  assert.match(invalid.error, /Некорректные параметры/);
  assert.equal(logs.length, 2);
});
