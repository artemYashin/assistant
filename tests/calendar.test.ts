import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { Store } from "../server/store.js";
import { Calendar } from "../server/calendar.js";
import {
  calendarInput,
  calendarOverlaps,
  calendarStatus,
  calendarNotificationsSchema,
} from "../server/calendar-model.js";
import { fromWall, wallTime } from "../src/calendar-time.js";
import { createApp } from "../server/app.js";
function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-calendar-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return store;
}
const event = {
  kind: "event" as const,
  title: "Review",
  description: "Notes",
  start: "2026-10-21T08:00:00.000Z",
  end: "2026-10-21T10:00:00.000Z",
  developerIds: [],
};
test("calendar range includes partial overlap, containment, touching endpoints, and timed reminders", () => {
  assert.equal(
    calendarOverlaps(event, "2026-10-21T09:00:00Z", "2026-10-21T11:00:00Z"),
    true,
  );
  assert.equal(
    calendarOverlaps(event, "2026-10-21T08:30:00Z", "2026-10-21T09:00:00Z"),
    true,
  );
  assert.equal(calendarOverlaps(event, "2026-10-21T10:00:00Z"), true);
  assert.equal(
    calendarOverlaps(event, undefined, "2026-10-21T08:00:00Z"),
    true,
  );
  assert.equal(calendarOverlaps(event, "2026-10-21T10:00:01Z"), false);
  assert.equal(
    calendarOverlaps({ ...event, end: null }, "2027-01-01T00:00:00Z"),
    false,
  );
  assert.equal(
    calendarOverlaps(
      { ...event, kind: "reminder", end: null },
      "2026-10-21T09:00:00Z",
    ),
    false,
  );
  assert.equal(
    calendarOverlaps({ ...event, kind: "general", start: null, end: null }),
    true,
  );
  assert.equal(
    calendarOverlaps({ ...event, start: null, end: null }, event.start),
    false,
  );
});
test("status distinguishes future, ongoing, overdue, general and completed without automatically completing", () => {
  const item = { ...event, completed: false };
  assert.equal(calendarStatus(item, "2026-10-21T07:00:00Z"), "upcoming");
  assert.equal(calendarStatus(item, "2026-10-21T08:00:00Z"), "ongoing");
  assert.equal(calendarStatus(item, event.end), "overdue");
  assert.equal(
    calendarStatus({ ...item, end: null }, "2027-01-01T00:00:00Z"),
    "overdue",
  );
  assert.equal(
    calendarStatus({ ...item, kind: "general", start: null, end: null }),
    "open",
  );
  assert.equal(calendarStatus({ ...item, completed: true }), "completed");
  assert.equal(
    calendarStatus({ ...item, kind: "reminder", end: null }, event.start),
    "overdue",
  );
});
test("calendar dates use configured zone, reject DST gaps and handle repeated times deterministically", () => {
  assert.equal(
    fromWall("2026-10-21T08:00", "Asia/Bishkek"),
    "2026-10-21T02:00:00.000Z",
  );
  assert.equal(
    wallTime("2026-10-21T02:00:00.000Z", "Asia/Bishkek"),
    "2026-10-21T08:00",
  );
  assert.throws(
    () => fromWall("2026-03-29T02:30", "Europe/Berlin"),
    /времени нет/,
  );
  assert.equal(
    fromWall("2026-10-25T02:30", "Europe/Berlin"),
    "2026-10-25T00:30:00.000Z",
  );
  assert.throws(() => fromWall("2026-02-30T09:00", "UTC"));
});
test("invalid reminder shapes and schedules are rejected", () => {
  assert.throws(() =>
    calendarInput.parse({ ...event, end: "2026-10-21T07:00:00Z" }),
  );
  assert.equal(
    calendarInput.parse({ ...event, kind: "general" }).kind,
    "event",
  );
  assert.equal(
    calendarInput.parse({ ...event, start: null, end: null }).kind,
    "general",
  );
  assert.equal(calendarInput.parse({ ...event, end: null }).kind, "reminder");
  assert.throws(() => calendarInput.parse({ ...event, start: null }));
  assert.throws(() =>
    calendarNotificationsSchema.parse({ intervalMinutes: 0 }),
  );
});
test("reminders persist, validate local developers, and completion/deletion stop repeated notifications", (t) => {
  const store = fixture(t),
    calendar = new Calendar(store);
  store.db
    .prepare("INSERT INTO local_developers VALUES ('d','Developer','','',1)")
    .run();
  assert.throws(
    () => calendar.save({ ...event, developerIds: ["missing"] }),
    /недоступен/,
  );
  const { id } = calendar.save({ ...event, developerIds: ["d", "d"] });
  const again = new Calendar(store);
  assert.deepEqual(again.list()[0].developerIds, ["d"]);
  assert.equal(again.list()[0].title, event.title);
  const now = new Date("2026-10-21T11:00:00Z");
  assert.equal(calendar.notifications(now).length, 1);
  assert.equal(
    again.notifications(now).length,
    0,
    "another tab cannot claim the same interval",
  );
  assert.equal(
    calendar.notifications(new Date(now.getTime() + 59 * 60000)).length,
    0,
  );
  assert.equal(
    calendar.notifications(new Date(now.getTime() + 60 * 60000)).length,
    1,
  );
  calendar.complete(id);
  assert.equal(
    calendar.notifications(new Date(now.getTime() + 120 * 60000)).length,
    0,
  );
  assert.equal(calendar.list()[0].completed, true);
  calendar.remove(id);
  assert.equal(calendar.list().length, 0);
  assert.throws(() => calendar.complete(id), /не найдено/);
});
test("notification schedule uses the shared timezone and never removes future items from the center", (t) => {
  const store = fixture(t),
    calendar = new Calendar(store);
  const settings = store.settings();
  store.set("settings", {
    ...settings,
    syncSchedule: { ...settings.syncSchedule, timeZone: "Asia/Bishkek" },
    calendarNotifications: calendarNotificationsSchema.parse({
      schedule: {
        mode: "scheduled",
        days: [3],
        start: "09:00",
        end: "18:00",
        timeZone: "UTC",
      },
      intervalMinutes: 30,
    }),
  });
  calendar.save({ kind: "general", title: "Open", start: null, end: null });
  calendar.save({ ...event, start: "2027-01-01T00:00:00Z", end: null });
  assert.equal(
    calendar.notifications(new Date("2026-10-21T02:59:00Z")).length,
    0,
  );
  assert.equal(
    calendar.notifications(new Date("2026-10-21T03:00:00Z")).length,
    1,
  );
  assert.equal(
    calendar.notifications(new Date("2026-10-21T12:00:00Z")).length,
    0,
  );
  assert.equal(calendar.list().length, 2);
});
test("API authenticates mutations, preserves existing timezone, and handles reminder lifecycle", async (t) => {
  const store = fixture(t),
    { app } = createApp(store);
  const headers = {
    Host: "localhost:43871",
    Origin: "http://localhost:43871",
    "X-Orbit-Request": "1",
  };
  await request(app).post("/api/calendar").set(headers).send(event).expect(401);
  const setup = await request(app)
    .post("/api/auth/setup")
    .set(headers)
    .send({ password: "long-enough-password" })
    .expect(200);
  const auth = {
    ...headers,
    Cookie: setup.headers["set-cookie"][0].split(";")[0],
    "X-CSRF-Token": setup.body.csrf,
  };
  const settings = store.settings();
  store.set("settings", {
    ...settings,
    syncSchedule: { ...settings.syncSchedule, timeZone: "Asia/Bishkek" },
  });
  assert.equal(
    (await request(app).get("/api/settings").set(auth)).body.syncSchedule
      .timeZone,
    "Asia/Bishkek",
  );
  const created = await request(app)
    .post("/api/calendar")
    .set(auth)
    .send(event)
    .expect(200);
  await request(app)
    .put("/api/calendar/" + created.body.id)
    .set(auth)
    .send({ ...event, title: "Changed" })
    .expect(200);
  assert.equal(
    (await request(app).get("/api/calendar").set(auth)).body.items[0].title,
    "Changed",
  );
  await request(app)
    .post("/api/calendar/" + created.body.id + "/complete")
    .set(auth)
    .send({})
    .expect(200);
  await request(app)
    .delete("/api/calendar/" + created.body.id)
    .set(auth)
    .expect(200);
  assert.deepEqual(
    (await request(app).get("/api/calendar").set(auth)).body.items,
    [],
  );
});

test("calendar survives a real store restart without changing the existing sync timezone", () => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-calendar-restart-"));
  let store = new Store(dir);
  try {
    store.set("settings", {
      ...store.settings(),
      syncSchedule: {
        ...store.settings().syncSchedule,
        timeZone: "Asia/Bishkek",
      },
    });
    const { id } = new Calendar(store).save(event);
    store.close();
    store = new Store(dir);
    assert.equal(new Calendar(store).list()[0].id, id);
    assert.equal(store.settings().syncSchedule.timeZone, "Asia/Bishkek");
    assert.equal(store.settings().calendarNotifications.browser, false);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reopening restores notifications globally and respects future start and schedule", (t) => {
  const store = fixture(t),
    calendar = new Calendar(store);
  store.addContext({ client: "A", project: "One" });
  store.addContext({ client: "B", project: "Two" });
  const now = new Date("2026-10-21T11:00:00Z");
  const { id } = calendar.save({
    ...event,
    scope: "project",
    client: "A",
    project: "One",
  });
  store.set("settings", { ...store.settings(), client: "B", project: "Two" });
  assert.equal(calendar.list().length, 1);
  assert.equal(calendar.notifications(now).length, 1);
  calendar.complete(id);
  assert.equal(calendar.notifications(now).length, 0);
  calendar.reopen(id);
  assert.equal(calendar.list()[0].completed, false);
  assert.equal(calendar.notifications(now).length, 0, "reopening waits for the shared interval");
  assert.equal(calendar.notifications(new Date(now.getTime() + 60 * 60000)).length, 1);
  assert.equal(calendar.notifications(new Date(now.getTime() + 60 * 60000)).length, 0);
  const future = calendar.save({
    ...event,
    start: "2027-01-01T00:00:00Z",
    end: null,
  }).id;
  calendar.complete(future);
  calendar.reopen(future);
  assert.equal(calendar.notifications(now).length, 0);
  store.set("settings", {
    ...store.settings(),
    calendarNotifications: calendarNotificationsSchema.parse({
      schedule: { mode: "scheduled", days: [] },
    }),
  });
  calendar.complete(id);
  calendar.reopen(id);
  assert.equal(calendar.notifications(now).length, 0);
});

test("scoped reminders validate ownership, follow renames and are removed with their owner", async (t) => {
  const store = fixture(t),
    calendar = new Calendar(store);
  const { deleteContext } = await import("../server/context-delete.js");
  store.addContext({ client: "A", project: "One" });
  store.addContext({ client: "B", project: "Two" });
  const global = calendar.save({ ...event }).id;
  calendar.save({ ...event, scope: "client", client: "A" });
  calendar.save({ ...event, scope: "project", client: "A", project: "One" });
  assert.throws(
    () =>
      calendar.save({
        ...event,
        scope: "project",
        client: "A",
        project: "Missing",
      }),
    /не найден/,
  );
  assert.throws(() =>
    calendar.save({ ...event, scope: "general", client: "A" }),
  );
  store.renameContext({ client: "A", project: "One" }, "Renamed");
  assert.ok(calendar.list().some((i) => i.project === "Renamed"));
  store.renameContext({ client: "A", project: "" }, "Customer");
  assert.equal(
    calendar.list().filter((i) => i.client === "Customer").length,
    2,
  );
  deleteContext(store, { client: "Customer", project: "Renamed" }, "удалить");
  assert.equal(calendar.list().length, 2);
  deleteContext(store, { client: "Customer", project: "" }, "удалить");
  assert.deepEqual(
    calendar.list().map((i) => i.id),
    [global],
  );
});

test("calendar scope migration preserves legacy reminders, completion and notification timestamp", async () => {
  const { default: Database } = await import("better-sqlite3");
  const dir = mkdtempSync(join(tmpdir(), "orbit-calendar-legacy-"));
  // Use the same database filename as Store.
  let store = new Store(dir);
  const path = store.db.name;
  store.close();
  const db = new Database(path);
  db.exec(
    "DROP TABLE calendar_events; CREATE TABLE calendar_events (id TEXT PRIMARY KEY,kind TEXT NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL,start TEXT,end TEXT,developers TEXT NOT NULL DEFAULT '[]',completed INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,last_notified INTEGER); INSERT INTO calendar_events VALUES ('legacy','general','Keep','Notes',NULL,NULL,'[]',1,'2026-10-21',123);",
  );
  db.close();
  try {
    store = new Store(dir);
    const item = new Calendar(store).list()[0];
    assert.equal(item.scope, "general");
    assert.equal(item.client, "");
    assert.equal(item.project, "");
    assert.equal(item.title, "Keep");
    assert.equal(item.completed, true);
    assert.equal(
      (
        store.db
          .prepare(
            "SELECT last_notified FROM calendar_events WHERE id='legacy'",
          )
          .get() as any
      ).last_notified,
      123,
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("time grid clips multi-day events, assigns overlap lanes and uses a Monday week", async () => {
  const { calendarSegments, calendarWeekDays } =
    await import("../src/calendar-layout.js");
  assert.deepEqual(calendarWeekDays("2026-10-21", "week"), [
    "2026-10-19",
    "2026-10-20",
    "2026-10-21",
    "2026-10-22",
    "2026-10-23",
    "2026-10-24",
    "2026-10-25",
  ]);
  const item = {
    ...calendarInput.parse(event),
    id: "one",
    completed: false,
    createdAt: event.start,
  };
  const segments = calendarSegments(
    [
      item,
      {
        ...item,
        id: "two",
        start: "2026-10-21T09:00:00Z",
        end: "2026-10-21T11:00:00Z",
      },
      { ...item, id: "done", completed: true },
    ],
    "2026-10-21",
    "UTC",
  );
  assert.equal(segments.length, 3);
  assert.ok(
    segments.some(
      (segment) => segment.item.id === "done" && segment.item.completed,
    ),
  );
  assert.equal(segments[0].top, 480);
  assert.equal(segments[0].bottom, 600);
  assert.equal(segments[0].lanes, 3);
  assert.notEqual(segments[0].lane, segments[1].lane);
  const spanning = {
    ...item,
    start: "2026-10-20T23:00:00Z",
    end: "2026-10-21T02:00:00Z",
  };
  assert.equal(calendarSegments([spanning], "2026-10-21", "UTC")[0].top, 0);
  assert.equal(
    calendarSegments([spanning], "2026-10-21", "UTC")[0].bottom,
    120,
  );
  assert.equal(
    calendarSegments(
      [{ ...spanning, end: "2026-10-21T00:00:00Z" }],
      "2026-10-21",
      "UTC",
    ).length,
    0,
  );
});

test("calendar gestures preserve duration and metadata, resize and respect timezone transitions", async () => {
  const { shiftCalendarItem } = await import("../src/calendar-layout.js");
  const item = {
    ...calendarInput.parse({
      title: "Gesture",
      start: "2026-10-24T03:00:00Z",
      end: "2026-10-24T04:00:00Z",
    }),
    id: "gesture",
    completed: false,
    createdAt: "2026-01-01T00:00:00Z",
  };
  const moved = shiftCalendarItem(item, 1470, false, "Asia/Bishkek");
  assert.equal(moved.start, "2026-10-25T03:30:00.000Z");
  assert.equal(moved.end, "2026-10-25T04:30:00.000Z");
  assert.equal(moved.title, item.title);
  assert.equal(
    shiftCalendarItem(item, -200, true, "Asia/Bishkek").end,
    "2026-10-24T03:15:00.000Z",
  );
  assert.equal(
    shiftCalendarItem({ ...item, end: null }, 30, false, "Asia/Bishkek").end,
    null,
  );
  assert.equal(
    shiftCalendarItem({ ...item, end: null }, 30, true, "Asia/Bishkek").end,
    "2026-10-24T04:00:00.000Z",
  );
  assert.throws(() =>
    shiftCalendarItem(
      { ...item, start: "2026-03-29T00:30:00Z" },
      60,
      false,
      "Europe/Berlin",
    ),
  );
  const dst = shiftCalendarItem(
    { ...item, start: "2026-03-28T08:00:00Z", end: "2026-03-28T10:00:00Z" },
    1440,
    false,
    "Europe/Berlin",
  );
  assert.equal(dst.start, "2026-03-29T07:00:00.000Z");
  assert.equal(Date.parse(dst.end!) - Date.parse(dst.start!), 7200000);
});

test("one persistent notification clock batches all reminders, including newly due and reopened items", t => {
  const store = fixture(t);
  const cal = new Calendar(store);
  const at = (time: string) => new Date("2026-10-21T" + time + ":00Z");
  const ids = Array.from({ length: 25 }, (_, i) =>
    cal.save({ ...event, title: "Batch " + i, start: "2026-10-21T09:00:00Z", end: null }).id,
  );
  const later = cal.save({ ...event, title: "Later", start: "2026-10-21T10:20:00Z", end: null }).id;
  const future = cal.save({ ...event, title: "Future", start: "2026-10-22T10:00:00Z", end: null }).id;
  assert.equal(cal.notifications(at("10:00")).length, 25, "do not split the batch at 20");
  assert.equal(cal.notifications(at("10:20")).length, 0, "newly due event waits for global cycle");
  cal.complete(ids[0]);
  cal.reopen(ids[0]);
  assert.equal(cal.notifications(at("10:30")).length, 0, "reopening does not reset global cycle");
  cal.complete(ids[1]);
  const general = cal.save({ ...event, title: "General", start: null, end: null }).id;
  assert.equal(cal.notifications(at("10:59")).length, 0, "new general reminder also waits");

  const secondStore = new Store(store.dir);
  try {
    const second = new Calendar(secondStore);
    assert.equal(second.notifications(at("10:59")).length, 0, "persisted across connections");
    const batch = second.notifications(at("11:00")).map(i => i.id);
    assert.equal(batch.length, 26);
    assert.ok(batch.includes(later));
    assert.ok(batch.includes(general));
    assert.ok(batch.includes(ids[0]));
    assert.ok(!batch.includes(ids[1]));
    assert.ok(!batch.includes(future));
    assert.equal(cal.notifications(at("11:00")).length, 0, "another caller cannot claim the same batch");
  } finally {
    secondStore.close();
  }
});

test("shared cycles omit completed daily occurrences and respect schedule without replaying missed batches", t => {
  const store = fixture(t);
  const cal = new Calendar(store);
  const ordinary = cal.save({ ...event, start: "2026-10-21T09:00:00Z", end: null }).id;
  const daily = cal.save({ ...event, title: "Daily", start: "2026-10-21T09:00:00Z", end: null, repeatDaily: true }).id;
  const at = (hour: number) => new Date(`2026-10-21T${String(hour).padStart(2, "0")}:00:00Z`);
  assert.equal(cal.notifications(at(10)).length, 2);
  cal.completeToday(daily, true, at(10));
  assert.deepEqual(cal.notifications(at(11)).map(i => i.id), [ordinary]);
  cal.completeToday(daily, false, at(11));
  assert.equal(cal.notifications(at(11)).length, 0);
  store.set("settings", {
    ...store.settings(),
    calendarNotifications: calendarNotificationsSchema.parse({
      schedule: { mode: "scheduled", days: [] },
    }),
  });
  assert.equal(cal.notifications(at(14)).length, 0);
  store.set("settings", {
    ...store.settings(),
    calendarNotifications: calendarNotificationsSchema.parse({}),
  });
  assert.equal(cal.notifications(at(15)).length, 2);
  assert.equal(cal.notifications(at(15)).length, 0);
});

test("advance warnings include upcoming reminders and today's daily iteration without changing dates", t => {
  const store = fixture(t), cal = new Calendar(store);
  assert.equal(store.settings().calendarNotifications.reminderLeadMinutes, 0);
  store.set("settings", { ...store.settings(), calendarNotifications: {
    ...store.settings().calendarNotifications, reminderLeadMinutes: 90,
  }});
  const reminder = cal.save({ ...event, start: "2026-10-21T10:00:00Z", end: null }).id;
  const daily = cal.save({ ...event, start: "2026-10-21T10:00:00Z", end: null, repeatDaily: true }).id;
  const future = cal.save({ ...event, start: "2026-10-21T10:01:00Z", end: null }).id;
  assert.equal(cal.notifications(new Date("2026-10-21T08:29:59Z")).length, 0);
  const batch = cal.notifications(new Date("2026-10-21T08:30:00Z"));
  assert.deepEqual(new Set(batch.map(i => i.id)), new Set([reminder, daily]));
  assert.ok(batch.every(i => i.start === "2026-10-21T10:00:00.000Z"));
  cal.complete(reminder);
  cal.completeToday(daily, true, new Date("2026-10-21T08:30:00Z"));
  assert.deepEqual(cal.notifications(new Date("2026-10-21T09:30:00Z")).map(i => i.id), [future]);
});
