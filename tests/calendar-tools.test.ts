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
test("assistant status tool only prepares confirmation and distinguishes daily scope", async (t) => {
  const store = fixture(t),
    calendar = new Calendar(store),
    events: any[] = [];
  const id = calendar.save({ title: "Ordinary", start: null, end: null }).id;
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
  ).find((t) => t.name === "prepare_calendar_status_change")!;
  const result = (await tool.handler!(
    { id, completed: true, target: "reminder" },
    {} as any,
  )) as any;
  assert.equal(result.changed, false);
  assert.equal(events[0].stage, "calendar_status");
  assert.equal(calendar.list().find((i) => i.id === id)!.completed, false);
  calendar.complete(id);
  await tool.handler!({ id, completed: false, target: "reminder" }, {} as any);
  assert.equal(calendar.list().find((i) => i.id === id)!.completed, true);
  await assert.rejects(
    () =>
      tool.handler!(
        { id: daily, completed: true, target: "reminder" },
        {} as any,
      ),
    /ежедневной/,
  );
  await tool.handler!(
    { id: daily, completed: true, target: "today" },
    {} as any,
  );
  await tool.handler!(
    { id: daily, completed: true, target: "series" },
    {} as any,
  );
  assert.equal(calendar.list().find((i) => i.id === daily)!.completed, false);
  const offline: any = calendarTools(store, () => {}).find(
    (t) => t.name === "prepare_calendar_status_change",
  )!;
  await assert.rejects(
    () =>
      offline.handler!({ id, completed: true, target: "reminder" }, {} as any),
    /интерфейса/,
  );
  calendar.remove(id);
  await assert.rejects(
    () => tool.handler!({ id, completed: true, target: "reminder" }, {} as any),
    /не найдено/,
  );
});
