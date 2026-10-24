import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { Calendar } from "../server/calendar.js";
import { calendarInput, type CalendarItem } from "../server/calendar-model.js";
import {
  dailyOccurrence,
  recurringOverlaps,
} from "../server/calendar-repeat.js";
import { calendarSegments } from "../src/calendar-layout.js";
const input = {
  title: "Daily",
  start: "2026-10-24T03:00:00.000Z",
  end: null,
  repeatDaily: true,
};
function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-repeat-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const settings = store.settings();
  store.set("settings", {
    ...settings,
    syncSchedule: { ...settings.syncSchedule, timeZone: "Asia/Bishkek" },
  });
  return store;
}
test("daily series repeats at configured interval until today is completed; series completion stops all days", (t) => {
  const store = fixture(t),
    cal = new Calendar(store),
    { id } = cal.save(input);
  assert.equal(cal.notifications(new Date("2026-10-24T02:59:00Z")).length, 0);
  assert.equal(cal.notifications(new Date("2026-10-24T03:00:00Z")).length, 1);
  assert.equal(cal.notifications(new Date("2026-10-24T03:59:00Z")).length, 0);
  assert.equal(cal.notifications(new Date("2026-10-24T04:00:00Z")).length, 1);
  cal.completeToday(id, true, new Date("2026-10-24T04:10:00Z"));
  assert.equal(cal.notifications(new Date("2026-10-24T14:00:00Z")).length, 0);
  assert.equal(dailyOccurrence(cal.list()[0], "2026-10-24")?.completed, true);
  assert.equal(dailyOccurrence(cal.list()[0], "2026-10-25")?.completed, false);
  cal.completeToday(id, false, new Date("2026-10-24T14:01:00Z"));
  assert.equal(cal.notifications(new Date("2026-10-24T14:02:00Z")).length, 1);
  cal.completeToday(id, true, new Date("2026-10-24T14:03:00Z"));
  assert.equal(cal.notifications(new Date("2026-10-25T02:59:00Z")).length, 0);
  const due = cal.notifications(new Date("2026-10-25T03:00:00Z"));
  assert.equal(due.length, 1);
  assert.equal(due[0].start, "2026-10-25T03:00:00.000Z");
  assert.equal(cal.list().length, 1);
  assert.equal(cal.list()[0].start, input.start);
  cal.complete(id);
  assert.equal(cal.notifications(new Date("2026-10-26T04:00:00Z")).length, 0);
  cal.reopen(id);
  assert.equal(cal.notifications(new Date("2026-10-26T04:00:00Z")).length, 1);
  assert.equal(
    (store.db.prepare("SELECT count(*) AS n FROM calendar_events").get() as any)
      .n,
    1,
  );
});
test("overlapping daily and ordinary events use independent lanes and retain one ID per series", (t) => {
  const cal = new Calendar(fixture(t));
  cal.save({ ...input, end: "2026-10-24T04:00:00Z" });
  cal.save({ ...input, title: "Other" });
  cal.save({ ...input, repeatDaily: false, title: "One-off" });
  const first = calendarSegments(cal.list(), "2026-10-24", "Asia/Bishkek");
  assert.equal(first.length, 3);
  assert.equal(new Set(first.map((i) => i.lane)).size, 3);
  const next = calendarSegments(cal.list(), "2026-10-25", "Asia/Bishkek");
  assert.equal(next.length, 2);
  assert.ok(next.every((i) => i.top === 540));
  assert.equal(
    calendarSegments(cal.list(), "2026-10-23", "Asia/Bishkek").length,
    0,
  );
  assert.equal(
    recurringOverlaps(
      cal.list().find((i) => i.title === "Daily")!,
      "2026-11-10T03:30:00Z",
      "2026-11-10T04:30:00Z",
    ),
    true,
  );
  assert.equal(
    recurringOverlaps(
      cal.list().find((i) => i.title === "Daily")!,
      "2026-11-10T05:00:00Z",
      "2026-11-10T06:00:00Z",
    ),
    false,
  );
});
test("daily time follows series timezone through DST and rejects missing start or excessive duration", () => {
  const item: CalendarItem = {
    ...calendarInput.parse({ ...input, start: "2026-03-28T08:00:00Z" }),
    id: "x",
    createdAt: input.start,
    completed: false,
    repeatZone: "Europe/Berlin",
  };
  assert.equal(
    dailyOccurrence(item, "2026-03-29")?.start,
    "2026-03-29T07:00:00.000Z",
  );
  assert.equal(
    dailyOccurrence({ ...item, start: "2026-03-28T01:30:00Z" }, "2026-03-29"),
    null,
  );
  assert.throws(() => calendarInput.parse({ ...input, start: null }));
  assert.throws(() =>
    calendarInput.parse({ ...input, end: "2026-10-26T03:00:00Z" }),
  );
});
