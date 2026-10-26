import test from "node:test";
import assert from "node:assert/strict";
import { sortReminders } from "../services/frontend/src/entities/calendar/index.js";
import {
  calendarInput,
  calendarOverlaps,
  type CalendarItem,
} from "../services/backend/src/calendar-model.js";
const now = "2026-10-24T10:00:00.000Z";
const item = (id: string, start: string | null): CalendarItem => ({
  ...calendarInput.parse({ title: id, start, end: null }),
  id,
  completed: false,
  createdAt: now,
});
test("nearest sort compares actual deadlines and event starts, with past, undated and completed after upcoming", () => {
  const ticket = {
    ...item("ticket", "2026-10-24T11:00:00Z"),
    ticket: { id: 42, source: "x", deadline: "2026-10-24T11:00:00Z" },
    warningStart: "2026-10-23T01:00:00Z",
  };
  const event = item("event", "2026-10-24T12:00:00Z");
  const past = item("past", "2026-10-23T12:00:00Z");
  const undated = item("undated", null);
  const done = { ...item("done", "2026-10-24T10:30:00Z"), completed: true };
  assert.deepEqual(
    sortReminders([undated, done, past, event, ticket], "nearest", now).map((i) => i.id),
    ["ticket", "event", "past", "undated", "done"],
  );
  assert.equal(calendarOverlaps(ticket, "2026-10-23T00:00:00Z", "2026-10-23T23:59:00Z"), false);
  assert.equal(calendarOverlaps(ticket, "2026-10-24T11:00:00Z", "2026-10-24T11:00:00Z"), true);
  assert.equal(calendarOverlaps(ticket, "2026-10-25T00:00:00Z", undefined), false);
});
test("daily series sorts by next unfinished occurrence rather than original series date", () => {
  const daily = {
    ...item("daily", "2020-01-01T11:00:00Z"),
    repeatDaily: true,
    repeatZone: "UTC",
    completedDays: ["2026-10-24"],
  };
  const event = item("event", "2026-10-24T12:00:00Z");
  assert.deepEqual(
    sortReminders([daily, event], "nearest", now).map((i) => i.id),
    ["event", "daily"],
  );
  assert.deepEqual(
    sortReminders([{ ...daily, completedDays: [] }, event], "nearest", now).map((i) => i.id),
    ["daily", "event"],
  );
});

test("nearest weekday repeat can fall beyond the next three days", () => {
  const monday = {
    ...item("monday", "2026-10-19T11:00:00Z"),
    repeatDaily: true,
    repeatZone: "UTC",
    repeatWeekdays: [1],
  };
  const thursday = item("thursday", "2026-10-22T12:00:00Z");
  assert.deepEqual(
    sortReminders([monday, thursday], "nearest", "2026-10-20T10:00:00Z").map((i) => i.id),
    ["thursday", "monday"],
  );
});
