import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../services/backend/src/store.js";
import { Calendar } from "../services/backend/src/calendar.js";
import { calendarStatus } from "../services/backend/src/calendar-model.js";
import { ticketMetadata, saveTicketMetadata } from "../services/backend/src/ticket-metadata.js";
import { listLocalTickets } from "../services/backend/src/ticket-list.js";
import { selectedExportColumns } from "../services/backend/src/ticket-export-columns.js";
import { calendarTools } from "../services/backend/src/calendar-tools.js";
function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-deadline-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  store.db
    .prepare("INSERT INTO tickets VALUES (?,42,'Bug','Active','','Example','','','')")
    .run(store.source());
  return store;
}
const due = "2026-11-10T12:00:00.000Z",
  context = { client: "", project: "" };
test("deadline lifecycle is separate from completion and Azure; survives edits, settings and restart", (t) => {
  const store = fixture(t),
    cal = new Calendar(store),
    source = store.source();
  const save = (localDeadline: string | null) =>
    saveTicketMetadata(store, 42, source, context, { localDeadline });
  save(due);
  const item = cal.list()[0];
  assert.equal(item.start, due);
  assert.equal(item.warningStart, "2026-11-09T12:00:00.000Z");
  assert.equal(item.end, null);
  assert.equal(item.ticket?.id, 42);
  assert.equal(cal.notifications(new Date("2026-11-09T11:59:00Z")).length, 0);
  assert.equal(cal.notifications(new Date(item.warningStart!)).length, 1);
  assert.equal(calendarStatus(item, "2026-11-09T13:00:00Z"), "ongoing");
  assert.equal(calendarStatus(item, due), "overdue");
  cal.complete(item.id);
  assert.equal(cal.notifications(new Date("2026-11-20T12:00:00Z")).length, 0);
  save(due);
  assert.equal(cal.list()[0].completed, true);
  saveTicketMetadata(store, 42, source, context, { notes: "other edit" });
  assert.equal(cal.list()[0].completed, true);
  cal.reopen(item.id);
  assert.equal(cal.notifications(new Date("2026-11-20T12:00:00Z")).length, 1);
  cal.complete(item.id);
  save("2026-11-11T12:00:00.000Z");
  assert.equal(cal.list()[0].id, item.id);
  assert.equal(cal.list()[0].completed, false);
  const settings = store.settings();
  store.set("settings", {
    ...settings,
    calendarNotifications: {
      ...settings.calendarNotifications,
      ticketDeadlineLeadMinutes: 300,
    },
  });
  assert.equal(cal.list()[0].start, "2026-11-11T12:00:00.000Z");
  assert.equal(cal.list()[0].warningStart, "2026-11-11T07:00:00.000Z");
  assert.throws(() => cal.save({ ...item, title: "other" }, item.id), /карточке тикета/);
  assert.equal(ticketMetadata(store, 42).localDeadline, "2026-11-11T12:00:00.000Z");
  cal.remove(item.id);
  assert.equal(ticketMetadata(store, 42).localDeadline, "2026-11-11T12:00:00.000Z");
  assert.equal(cal.list()[0].completed, true);
  save(due);
  save(null);
  assert.equal(cal.list().length, 0);
});
test("deadline filters, selected output, export and source isolation", (t) => {
  const store = fixture(t);
  saveTicketMetadata(store, 42, store.source(), context, {
    localDeadline: due,
  });
  const result = listLocalTickets(store, {
    fields: ["localDeadline"],
    sortBy: "localDeadline",
    deadlineFrom: due,
    deadlineTo: due,
  });
  assert.equal(result.total, 1);
  assert.equal(result.tickets[0].localDeadline, due);
  assert.equal(listLocalTickets(store, { deadlineTo: "2026-11-09T00:00:00Z" }).total, 0);
  assert.equal(ticketMetadata(store, 42, "other").localDeadline, null);
  assert.equal(
    selectedExportColumns(["localDeadline"])[0].value({
      ...result.tickets[0],
      id: 42,
    }),
    due,
  );
});
test("old settings gain lead default; missing active ticket suspends notifications; hard metadata deletion cleans reminders", (t) => {
  const store = fixture(t),
    cal = new Calendar(store);
  store.set("settings", {
    ...store.settings(),
    calendarNotifications: { browser: false, intervalMinutes: 60 },
  });
  assert.equal(store.settings().calendarNotifications.ticketDeadlineLeadMinutes, 1440);
  saveTicketMetadata(store, 42, store.source(), context, {
    localDeadline: due,
  });
  store.db.prepare("DELETE FROM tickets WHERE id=42").run();
  assert.equal(cal.list().length, 0);
  assert.equal(cal.notifications(new Date(due)).length, 0);
  store.db
    .prepare("INSERT INTO tickets VALUES (?,42,'Bug','Active','','Restored','','','')")
    .run(store.source());
  assert.equal(cal.list().length, 1);
  store.db.prepare("DELETE FROM ticket_metadata WHERE id=42").run();
  assert.equal(cal.list().length, 0);
});
test("assistant creates reminders immediately and emits refresh events for all date formats", async (t) => {
  const store = fixture(t),
    emitted: any[] = [];
  const tools = calendarTools(
    store,
    () => {},
    (e) => emitted.push(e),
  );
  for (const tool of tools) assert.doesNotThrow(() => (tool.parameters as any).toJSONSchema());
  const context: any = await tools[0].handler!({} as any, {} as any);
  assert.ok(context.now);
  assert.ok(context.timeZone);
  for (const dates of [
    { start: null, end: null },
    { start: due, end: null },
    { start: due, end: "2026-11-10T13:00:00Z" },
    { start: due, end: null, repeatDaily: true },
  ]) {
    await tools.find((t) => t.name === "save_calendar_reminder")!.handler!(
      { reminder: { title: "Reminder", ...dates } } as any,
      {} as any,
    );
  }
  assert.equal(emitted.length, 4);
  assert.ok(emitted.every((e) => e.stage === "calendar_changed"));
  const calendar = new Calendar(store);
  assert.equal(calendar.list().length, 4);
  assert.ok(calendar.list().some((i) => i.kind === "general"));
  assert.ok(calendar.list().some((i) => i.kind === "event"));
  assert.ok(calendar.list().some((i) => i.repeatDaily));
});

test("deadline migration and manual completion survive a database reopen", () => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-deadline-reopen-"));
  let store = new Store(dir);
  try {
    store.db
      .prepare("INSERT INTO tickets VALUES (?,42,'Example','Active','','Bug','','','')")
      .run(store.source());
    saveTicketMetadata(store, 42, store.source(), context, {
      notes: "preserved",
      localDeadline: due,
    });
    const calendar = new Calendar(store),
      id = calendar.list()[0].id;
    calendar.complete(id);
    store.close();
    store = new Store(dir);
    assert.equal(ticketMetadata(store, 42).notes, "preserved");
    assert.equal(ticketMetadata(store, 42).localDeadline, due);
    const restored = new Calendar(store).list();
    assert.equal(restored.length, 1);
    assert.equal(restored[0].id, id);
    assert.equal(restored[0].completed, true);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("overdue filter uses current time, excludes missing/future deadlines and works in notes and trash", async (t) => {
  const store = fixture(t);
  const now = new Date("2026-10-24T12:00:00.000Z");
  t.mock.timers.enable({ apis: ["Date"], now });
  const { searchTicketContent } = await import("../services/backend/src/ticket-content-search.js");
  for (const id of [43, 44, 45]) {
    store.db
      .prepare("INSERT INTO tickets VALUES (?,?,'Bug','Closed','','Example','','','')")
      .run(store.source(), id);
  }
  const past = "2026-10-24T11:59:59.999Z";
  for (const [id, deadline] of [
    [42, past],
    [43, now.toISOString()],
    [44, "2026-10-25T12:00:00.000Z"],
    [45, null],
  ] as const) {
    saveTicketMetadata(store, id, store.source(), context, {
      localDeadline: deadline,
      notes: "deadline evidence",
    });
  }
  const ids = (input: object) => listLocalTickets(store, input).tickets.map((t) => t.id);
  assert.deepEqual(ids({ overdueDeadline: true }), [42]);
  assert.equal(ids({ overdueDeadline: false }).length, 4);
  assert.deepEqual(ids({ overdueDeadline: true, state: ["Closed"] }), []);
  assert.deepEqual(ids({ overdueDeadline: true, deadlineFrom: now.toISOString() }), []);
  new Calendar(store).complete(new Calendar(store).list().find((i) => i.ticket?.id === 42)!.id);
  assert.deepEqual(ids({ overdueDeadline: true }), [42]);
  assert.deepEqual(
    searchTicketContent(store, { search: "evidence", overdueDeadline: true }).tickets.map(
      (t) => t.id,
    ),
    [42],
  );
  store.removeLocalTicket(42);
  assert.deepEqual(ids({ overdueDeadline: true, lifecycle: "active" }), []);
  assert.deepEqual(ids({ overdueDeadline: true, lifecycle: "deleted" }), [42]);
  assert.deepEqual(
    searchTicketContent(store, {
      search: "evidence",
      overdueDeadline: true,
      lifecycle: "deleted",
    }).tickets.map((t) => t.id),
    [42],
  );
});

test("deadline reminders follow current local assignees without reopening completed reminders", async (t) => {
  const store = fixture(t);
  const { LocalDevelopers } = await import("../services/backend/src/local-developers.js");
  const developers = new LocalDevelopers(store);
  const people = developers.add(["One", "Two"], context);
  developers.assign(42, [people[0].id], context);
  saveTicketMetadata(store, 42, store.source(), context, { localDeadline: due });
  const calendar = new Calendar(store);
  const original = calendar.list()[0];
  assert.deepEqual(original.developerIds, [people[0].id]);
  calendar.complete(original.id);
  developers.assign(
    42,
    people.map((p) => p.id),
    context,
  );
  const changed = calendar.list()[0];
  assert.equal(changed.id, original.id);
  assert.equal(changed.completed, true);
  assert.deepEqual(changed.developerIds, people.map((p) => p.id).sort());
  // Existing deadline rows and same ticket ID in another connection cannot leak assignments.
  store.db.prepare("UPDATE calendar_events SET developers='[]' WHERE id=?").run(original.id);
  store.db.prepare("INSERT INTO ticket_developers VALUES ('other',42,?)").run(people[1].id);
  developers.assign(42, [people[0].id], context);
  assert.deepEqual(calendar.list()[0].developerIds, [people[0].id]);
  developers.assign(42, [], context);
  assert.deepEqual(calendar.list()[0].developerIds, []);
  assert.equal(calendar.list()[0].completed, true);
});

test("ordinary reminder advance does not add a second lead time to ticket deadlines", (t) => {
  const store = fixture(t),
    cal = new Calendar(store);
  store.set("settings", {
    ...store.settings(),
    calendarNotifications: {
      ...store.settings().calendarNotifications,
      reminderLeadMinutes: 2880,
      ticketDeadlineLeadMinutes: 90,
    },
  });
  saveTicketMetadata(store, 42, store.source(), context, { localDeadline: due });
  assert.equal(cal.notifications(new Date("2026-11-10T10:29:59Z")).length, 0);
  assert.equal(cal.notifications(new Date("2026-11-10T10:30:00Z")).length, 1);
});

test("ticket warning override survives deadline edits and restores global default", (t) => {
  const store = fixture(t),
    cal = new Calendar(store);
  saveTicketMetadata(store, 42, store.source(), context, { localDeadline: due });
  const id = cal.list()[0].id;
  cal.setLead(id, 10);
  assert.equal(cal.list()[0].start, due);
  assert.equal(cal.list()[0].warningStart, "2026-11-10T11:50:00.000Z");
  assert.equal(cal.notifications(new Date("2026-11-10T11:49:00Z")).length, 0);
  assert.equal(cal.notifications(new Date("2026-11-10T11:50:00Z")).length, 1);
  saveTicketMetadata(store, 42, store.source(), context, { localDeadline: "2026-11-11T12:00:00Z" });
  assert.equal(cal.list()[0].leadMinutes, 10);
  cal.setLead(id, null);
  assert.equal(cal.list()[0].start, "2026-11-11T12:00:00.000Z");
  assert.equal(cal.list()[0].warningStart, "2026-11-10T12:00:00.000Z");
});

test("assistant batch deletion completes ticket deadline reminders and preserves ticket metadata", async (t) => {
  const store = fixture(t),
    calendar = new Calendar(store);
  saveTicketMetadata(store, 42, store.source(), context, {
    localDeadline: due,
    notes: "Keep notes",
  });
  const deadline = calendar.list()[0].id;
  const ordinary = calendar.save({ title: "Remove me", start: null, end: null }).id;
  const tool: any = calendarTools(store, () => {}).find(
    (t) => t.name === "change_calendar_reminders",
  );
  await assert.rejects(
    () =>
      tool.handler({
        action: "delete",
        items: [
          { id: deadline, target: "reminder" },
          { id: ordinary, target: "reminder" },
          { id: "00000000-0000-4000-8000-000000000000", target: "reminder" },
        ],
      }),
    /не найдено/,
  );
  assert.equal(calendar.list().find((i) => i.id === deadline)!.completed, false);
  assert.equal(calendar.list().length, 2);
  const result = await tool.handler({
    action: "delete",
    items: [
      { id: deadline, target: "reminder" },
      { id: ordinary, target: "reminder" },
    ],
  });
  assert.equal(result.deleted, 1);
  assert.equal(result.completed, 1);
  assert.equal(calendar.list().length, 1);
  assert.equal(calendar.list()[0].completed, true);
  assert.equal(ticketMetadata(store, 42).localDeadline, due);
  assert.equal(ticketMetadata(store, 42).notes, "Keep notes");
  assert.ok(store.db.prepare("SELECT 1 FROM tickets WHERE id=42").get());
});

test("deadline badge distinguishes warning start from deadline and ignores stale end dates", async () => {
  const { calendarStatusLabel } =
    await import("../services/frontend/src/entities/calendar/index.js");
  const item = {
    start: "2026-10-23T17:59:00Z",
    end: null,
    kind: "reminder" as const,
    completed: false,
    ticket: { id: 42, source: "test", deadline: "2026-10-24T17:59:00Z" },
  };
  assert.equal(calendarStatusLabel(item, "2026-10-23T17:58:59Z"), "Дедлайн впереди");
  assert.equal(calendarStatusLabel(item, "2026-10-24T06:00:00Z"), "Дедлайн приближается");
  assert.equal(calendarStatusLabel(item, "2026-10-24T17:59:00Z"), "Дедлайн просрочен");
  const yesterday = { ...item, ticket: { ...item.ticket, deadline: "2026-10-23T17:59:00Z" } };
  assert.equal(calendarStatusLabel(yesterday, "2026-10-24T06:00:00Z"), "Дедлайн просрочен");
  assert.equal(
    calendarStatus(
      { ...yesterday, kind: "event", end: "2026-10-26T00:00:00Z" },
      "2026-10-24T06:00:00Z",
    ),
    "overdue",
  );
  assert.equal(calendarStatus({ ...yesterday, start: null }, "2026-10-24T06:00:00Z"), "overdue");
  assert.equal(
    calendarStatusLabel({ ...yesterday, completed: true }, "2026-10-24T06:00:00Z"),
    "Напоминание завершено",
  );
});

test("legacy deadline warning positions repair to actual deadline without losing completion or override", (t) => {
  const store = fixture(t),
    cal = new Calendar(store);
  saveTicketMetadata(store, 42, store.source(), context, { localDeadline: due });
  const id = cal.list()[0].id;
  cal.setLead(id, 2040);
  cal.complete(id);
  store.db
    .prepare("UPDATE calendar_events SET start=? WHERE id=?")
    .run("2026-11-09T02:00:00.000Z", id);
  const restored = cal.list()[0];
  assert.equal(restored.id, id);
  assert.equal(restored.start, due);
  assert.equal(restored.warningStart, "2026-11-09T02:00:00.000Z");
  assert.equal(restored.leadMinutes, 2040);
  assert.equal(restored.completed, true);
});
