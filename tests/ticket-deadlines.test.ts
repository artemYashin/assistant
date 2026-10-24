import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { Calendar } from "../server/calendar.js";
import { calendarStatus } from "../server/calendar-model.js";
import {
  ticketMetadata,
  saveTicketMetadata,
} from "../server/ticket-metadata.js";
import { listLocalTickets } from "../server/ticket-list.js";
import { selectedExportColumns } from "../server/ticket-export-columns.js";
import { calendarTools } from "../server/calendar-tools.js";
function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-deadline-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  store.db
    .prepare(
      "INSERT INTO tickets VALUES (?,42,'Bug','Active','','Example','','','')",
    )
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
  assert.equal(item.start, "2026-11-09T12:00:00.000Z");
  assert.equal(item.end, null);
  assert.equal(item.ticket?.id, 42);
  assert.equal(cal.notifications(new Date("2026-11-09T11:59:00Z")).length, 0);
  assert.equal(cal.notifications(new Date(item.start!)).length, 1);
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
  assert.equal(cal.list()[0].start, "2026-11-11T07:00:00.000Z");
  assert.throws(
    () => cal.save({ ...item, title: "other" }, item.id),
    /карточке тикета/,
  );
  assert.equal(
    ticketMetadata(store, 42).localDeadline,
    "2026-11-11T12:00:00.000Z",
  );
  cal.remove(item.id);
  assert.equal(ticketMetadata(store, 42).localDeadline, null);
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
  assert.equal(
    listLocalTickets(store, { deadlineTo: "2026-11-09T00:00:00Z" }).total,
    0,
  );
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
  assert.equal(
    store.settings().calendarNotifications.ticketDeadlineLeadMinutes,
    1440,
  );
  saveTicketMetadata(store, 42, store.source(), context, {
    localDeadline: due,
  });
  store.db.prepare("DELETE FROM tickets WHERE id=42").run();
  assert.equal(cal.list().length, 0);
  assert.equal(cal.notifications(new Date(due)).length, 0);
  store.db
    .prepare(
      "INSERT INTO tickets VALUES (?,42,'Bug','Active','','Restored','','','')",
    )
    .run(store.source());
  assert.equal(cal.list().length, 1);
  store.db.prepare("DELETE FROM ticket_metadata WHERE id=42").run();
  assert.equal(cal.list().length, 0);
});
test("assistant reminder preparation only emits a draft; supports all date formats and timezone context", async (t) => {
  const store = fixture(t),
    emitted: any[] = [];
  const tools = calendarTools(
    store,
    () => {},
    (e) => emitted.push(e),
  );
  for (const tool of tools)
    assert.doesNotThrow(() => (tool.parameters as any).toJSONSchema());
  const context: any = await tools[0].handler!({} as any, {} as any);
  assert.ok(context.now);
  assert.ok(context.timeZone);
  for (const dates of [
    { start: null, end: null },
    { start: due, end: null },
    { start: due, end: "2026-11-10T13:00:00Z" },
    { start: due, end: null, repeatDaily: true },
  ]) {
    await tools[1].handler!({ title: "Reminder", ...dates } as any, {} as any);
  }
  assert.equal(emitted.length, 4);
  assert.equal(emitted[0].draft.kind, "general");
  assert.equal(emitted[2].draft.kind, "event");
  assert.equal(emitted[3].stage, "calendar_draft");
  assert.equal(emitted[3].draft.repeatDaily, true);
  assert.equal((tools[1].parameters as any).toJSONSchema().properties.repeatDaily.type, "boolean");
  const calendar = new Calendar(store);
  assert.equal(calendar.list().length, 0);
  // The same draft is saved only after the user's UI confirmation.
  calendar.save(emitted[3].draft);
  assert.equal(calendar.list().length, 1);
  assert.equal(calendar.list()[0].repeatDaily, true);
});

test("deadline migration and manual completion survive a database reopen", () => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-deadline-reopen-"));
  let store = new Store(dir);
  try {
    store.db
      .prepare(
        "INSERT INTO tickets VALUES (?,42,'Example','Active','','Bug','','','')",
      )
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
