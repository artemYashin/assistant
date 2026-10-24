import test from "node:test";
import assert from "node:assert/strict";
import {
  notificationDue,
  notificationItems,
} from "../server/calendar-notifications.js";
import { calendarInput, type CalendarItem } from "../server/calendar-model.js";
const ticket: CalendarItem = {
  ...calendarInput.parse({
    title: "Deadline",
    start: "2026-10-26T09:00:00.000Z",
    end: null,
  }),
  id: "test",
  completed: false,
  createdAt: "2026-10-24T00:00:00Z",
  ticket: { id: 42, source: "azure", deadline: "2026-10-26T15:00:00+06:00" },
  warningStart: "2026-10-26T12:00:00+06:00",
  leadMinutes: 180,
};
test("header and delivery exclude deadlines before warning and keep overdue until completed", () => {
  for (const [time, count] of [
    ["2026-10-26T11:59:59+06:00", 0],
    ["2026-10-26T12:00:00+06:00", 1],
    ["2026-10-26T15:00:00+06:00", 1],
    ["2026-10-28T15:00:00+06:00", 1],
  ] as const) {
    assert.equal(
      notificationItems([ticket], 1440, new Date(time)).length,
      count,
    );
  }
  assert.equal(
    notificationItems(
      [{ ...ticket, completed: true }],
      1440,
      new Date("2026-10-28"),
    ).length,
    0,
  );
});
test("visible alert becomes ineligible when warning is moved into the future", () => {
  const now = new Date("2026-10-26T13:00:00+06:00");
  assert.equal(notificationDue(ticket, 0, now), true);
  assert.equal(
    notificationDue(
      { ...ticket, warningStart: "2026-10-26T14:00:00+06:00", leadMinutes: 60 },
      0,
      now,
    ),
    false,
  );
});
test("ordinary reminders use individual lead, undated reminders remain eligible", () => {
  const regular = { ...ticket, ticket: undefined, warningStart: undefined };
  assert.equal(
    notificationDue(regular, 1440, new Date("2026-10-26T11:59:59+06:00")),
    false,
  );
  assert.equal(
    notificationDue(regular, 1440, new Date("2026-10-26T12:00:00+06:00")),
    true,
  );
  assert.equal(
    notificationDue({ ...regular, start: null }, 0, new Date("2026-10-24")),
    true,
  );
});

test("hidden notifications exclude every kind and recurring series, not calendar-only hiding", () => {
  const now = new Date("2026-10-26T16:00:00Z");
  for (const item of [
    ticket,
    { ...ticket, ticket: undefined, repeatDaily: true, repeatZone: "UTC" },
    { ...ticket, ticket: undefined, start: null, end: null },
    { ...ticket, ticket: undefined, vacation: { developerId: "dev", start: "2026-10-26", end: "2026-10-29", zone: "UTC", returnDate: "2026-10-30" }, end: "2026-10-29T23:59:59Z" },
  ]) {
    assert.equal(notificationItems([{ ...item, notificationsHidden: true }], 0, now).length, 0);
    assert.equal(notificationDue({ ...item, notificationsHidden: true }, 0, now), false);
    assert.ok(notificationItems([{ ...item, calendarHidden: true }], 0, now).length > 0);
  }
});
