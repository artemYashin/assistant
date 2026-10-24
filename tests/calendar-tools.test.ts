import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { Calendar } from "../server/calendar.js";
import { searchCalendar } from "../server/calendar-search.js";
import { calendarTools } from "../server/calendar-tools.js";

function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-calendar-tools-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return store;
}
test("calendar search includes completed history, safe regex, AND filters, overlap and stable pagination", (t) => {
  const store = fixture(t),
    calendar = new Calendar(store);
  store.addContext({ client: "Client", project: "Project" });
  const old = calendar.save({
    title: "Old release",
    description: "fix regression",
    start: "2020-01-01T08:00:00Z",
    end: "2020-01-01T10:00:00Z",
    scope: "project",
    client: "Client",
    project: "Project",
  }).id;
  calendar.complete(old);
  const future = calendar.save({
    title: "Future release",
    description: "x".repeat(2000),
    start: "2099-01-01T08:00:00Z",
    end: null,
  }).id;
  calendar.save({ title: "Shopping", start: null, end: null });
  assert.equal(searchCalendar(store, {}).total, 3);
  assert.deepEqual(
    searchCalendar(store, {
      query: "OLD|future",
      searchMode: "regex",
      sortBy: "start",
      sortDirection: "asc",
    }).reminders.map((i) => i.id),
    [old, future],
  );
  assert.equal(searchCalendar(store, { query: "OLD|future" }).total, 0);
  assert.equal(
    searchCalendar(store, {
      query: "regression",
      completed: "completed",
      clients: ["Client"],
      projects: ["Project"],
      from: "2020-01-01T09:00:00Z",
      to: "2020-01-01T11:00:00Z",
    }).reminders[0].id,
    old,
  );
  assert.equal(
    searchCalendar(store, { completed: "open", clients: ["Client"] }).total,
    0,
  );
  assert.equal(
    searchCalendar(store, {
      from: "2020-01-01T10:00:00Z",
      to: "2020-01-01T10:00:00Z",
    }).total,
    1,
  );
  assert.equal(
    searchCalendar(store, { statuses: ["completed"] }).reminders[0].id,
    old,
  );
  const first = searchCalendar(store, {
    sortBy: "start",
    sortDirection: "asc",
    limit: 1,
  });
  assert.equal(first.nextOffset, 1);
  assert.equal(
    searchCalendar(store, {
      sortBy: "start",
      sortDirection: "asc",
      offset: first.nextOffset!,
      limit: 1,
    }).reminders[0].id,
    future,
  );
  assert.equal(
    searchCalendar(store, { ids: [future] }).reminders[0].descriptionSnippet
      .length,
    240,
  );
  assert.throws(
    () => searchCalendar(store, { query: "(", searchMode: "regex" }),
    /регулярное/,
  );
  assert.throws(() =>
    searchCalendar(store, {
      from: "2026-02-01T00:00:00Z",
      to: "2026-01-01T00:00:00Z",
    }),
  );
  assert.throws(() => searchCalendar(store, { limit: 1000 }));
});
test("calendar search matches assignees and recurring occurrences across scope without expanding daily rows", (t) => {
  const store = fixture(t),
    calendar = new Calendar(store);
  store.db
    .prepare("INSERT INTO local_developers VALUES ('dev','Developer','','',1)")
    .run();
  const id = calendar.save({
    title: "Daily",
    start: "2020-01-01T08:00:00Z",
    end: null,
    repeatDaily: true,
    developerIds: ["dev"],
  }).id;
  const result = searchCalendar(store, {
    kinds: ["daily"],
    developerIds: ["dev", "missing"],
    from: "2026-10-24T00:00:00Z",
    to: "2026-10-25T23:00:00Z",
  });
  assert.equal(result.total, 1);
  assert.equal(result.reminders[0].id, id);
  assert.equal(result.reminders[0].developers[0].name, "Developer");
  assert.equal(searchCalendar(store, { kinds: ["ticket"] }).total, 0);
  assert.equal(searchCalendar(store, { developerIds: ["missing"] }).total, 0);
});
test("assistant batch status executes directly without dialogs and rolls back invalid batches", async (t) => {
  const store = fixture(t),
    calendar = new Calendar(store),
    events: any[] = [];
  const ids = Array.from(
    { length: 65 },
    (_, i) =>
      calendar.save({ title: `Reminder ${i}`, start: null, end: null }).id,
  );
  const daily = calendar.save({
    title: "Daily",
    start: "2020-01-01T08:00:00Z",
    end: null,
    repeatDaily: true,
  }).id;
  const tool: any = calendarTools(
    store,
    () => {},
    (e) => events.push(e),
  ).find((t) => t.name === "change_calendar_reminders");
  const items = [
    ...ids.map((id) => ({ id, target: "reminder" })),
    { id: daily, target: "series" },
  ];
  const result = await tool.handler({
    action: "complete",
    items: [...items, items[0]],
  });
  assert.equal(result.count, 66);
  assert.equal(result.completed, 66);
  assert.ok(calendar.list().every((i) => i.completed));
  assert.deepEqual(events, [{ stage: "calendar_changed" }]);
  await assert.rejects(
    () =>
      tool.handler({
        action: "reopen",
        items: [items[0], { id: daily, target: "reminder" }],
      }),
    /ежедневной/,
  );
  assert.ok(
    calendar.list().every((i) => i.completed),
    "all writes rolled back",
  );
  assert.equal(events.length, 1, "no success event on rollback");
  await tool.handler({ action: "reopen", items });
  await tool.handler({
    action: "complete",
    items: [{ id: daily, target: "occurrence", day: "2026-10-25" }],
  });
  const series = calendar.list().find((i) => i.id === daily)!;
  assert.equal(series.completed, false);
  assert.deepEqual(series.completedDays, ["2026-10-25"]);
  await assert.rejects(
    () =>
      tool.handler({
        action: "delete",
        items: [
          items[0],
          { id: daily, target: "occurrence", day: "2026-10-25" },
        ],
      }),
    /повтор/,
  );
  assert.ok(
    calendar.list().some((i) => i.id === ids[0]),
    "delete also rolls back",
  );
  const offline: any = calendarTools(store, () => {}).find(
    (t) => t.name === "change_calendar_reminders",
  );
  await offline.handler({ action: "complete", items: [items[0]] });
  assert.equal(calendar.list().find((i) => i.id === ids[0])!.completed, true);
});

test("assistant warnings and edits save immediately; full read preserves content", async (t) => {
  const store = fixture(t),
    calendar = new Calendar(store),
    events: any[] = [];
  const id = calendar.save({
    title: "Daily",
    description: "Full description",
    start: "2026-10-25T01:00:00Z",
    end: null,
    repeatDaily: true,
  }).id;
  const tools = calendarTools(
    store,
    () => {},
    (e) => events.push(e),
  );
  const warning: any = tools.find((t) => t.name === "update_calendar_warning");
  const result = await warning.handler({ id, leadMinutes: 120 });
  assert.equal(result.saved, true);
  assert.equal(calendar.list()[0].leadMinutes, 120);
  const row = searchCalendar(store, { ids: [id] }).reminders[0];
  assert.equal(row.effectiveLeadMinutes, 120);
  const read: any = tools.find((t) => t.name === "get_calendar_reminder");
  const full = await read.handler({ id });
  assert.equal(full.description, "Full description");
  const save: any = tools.find((t) => t.name === "save_calendar_reminder");
  await save.handler({
    id,
    reminder: {
      title: "Edited",
      description: full.description,
      start: full.start,
      end: null,
      repeatDaily: true,
      leadMinutes: full.leadMinutes,
    },
  });
  assert.equal(calendar.list()[0].title, "Edited");
  assert.equal(calendar.list()[0].description, "Full description");
  assert.ok(events.every((e) => e.stage === "calendar_changed"));
});
