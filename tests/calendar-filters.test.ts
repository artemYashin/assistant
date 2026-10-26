import test from "node:test";
import assert from "node:assert/strict";
import { parseCalendarFilters } from "../services/frontend/src/features/filter-calendar/index.js";
import {
  calendarInput,
  calendarMatchesStatus,
  calendarStatus,
  type CalendarItem,
} from "../services/backend/src/calendar-model.js";
test("reminder preset roundtrip keeps all selections and dates", () => {
  const filters = {
    clientFilter: ["=Customer", "none"],
    projectFilter: ['["Customer","Project"]'],
    status: ["overdue", "completed"],
    types: ["reminder", "ticket"],
    query: "deadline",
    from: "2026-10-24T12:30",
    to: "2026-10-26T15:00",
    sort: "desc",
  };
  assert.deepEqual(parseCalendarFilters(JSON.parse(JSON.stringify(filters))), filters);
});
test("legacy single-select current filters and presets migrate without losing selections", () => {
  const migrated = parseCalendarFilters({
    clientFilter: "=Customer",
    projectFilter: "all",
    status: "recurring",
  });
  assert.deepEqual(migrated.clientFilter, ["=Customer"]);
  assert.deepEqual(migrated.projectFilter, []);
  assert.deepEqual(migrated.status, ["recurring"]);
  assert.deepEqual(migrated.types, []);
  assert.deepEqual(parseCalendarFilters({ types: ["ticket", "invalid", "ticket"] }).types, [
    "ticket",
  ]);
  assert.deepEqual(
    parseCalendarFilters({
      status: "bogus",
      sort: "bogus",
      query: 123,
      from: "not-a-date",
      priority: [1],
    }),
    parseCalendarFilters(null),
  );
});
test("recurring series stays in recurring filter after today's completion and on the next day", () => {
  const item: CalendarItem = {
    ...calendarInput.parse({
      title: "Daily",
      start: "2026-10-24T08:00:00Z",
      end: null,
      repeatDaily: true,
    }),
    id: "series",
    createdAt: "2026-10-24T00:00:00Z",
    completed: false,
    completedDays: ["2026-10-24"],
    repeatZone: "UTC",
  };
  assert.equal(calendarStatus(item, "2026-10-24T09:00:00Z"), "today_completed");
  assert.equal(calendarMatchesStatus(item, ["recurring"], "2026-10-24T09:00:00Z"), true);
  assert.equal(
    calendarMatchesStatus(item, ["today_completed", "completed"], "2026-10-24T09:00:00Z"),
    true,
  );
  assert.equal(calendarStatus(item, "2026-10-25T09:00:00Z"), "recurring");
  assert.equal(calendarMatchesStatus(item, ["today_completed"], "2026-10-25T09:00:00Z"), false);
  assert.equal(calendarMatchesStatus({ ...item, completed: true }, ["recurring"]), true);
  assert.equal(calendarMatchesStatus({ ...item, completed: true }, ["active"]), false);
});
