import test from "node:test";
import assert from "node:assert/strict";
import { syncAllowed, syncScheduleSchema } from "../server/sync-schedule.js";

test("schedule defaults allow automatic updates at any time", () => {
  assert.equal(
    syncAllowed(syncScheduleSchema.parse({}), new Date("2026-10-18T03:00Z")),
    true,
  );
});
test("working hours use configured timezone and exclude the end boundary", () => {
  const schedule = syncScheduleSchema.parse({
    mode: "scheduled",
    timeZone: "Asia/Bishkek",
  });
  for (const [at, allowed] of [
    ["2026-10-19T02:59Z", false],
    ["2026-10-19T03:00Z", true],
    ["2026-10-19T12:00Z", false],
    ["2026-10-18T05:00Z", false],
  ] as const)
    assert.equal(syncAllowed(schedule, new Date(at)), allowed, at);
});
test("overnight window belongs to its start day, including Sunday rollover", () => {
  const schedule = syncScheduleSchema.parse({
    mode: "scheduled",
    start: "22:00",
    end: "06:00",
    days: [7],
  });
  assert.equal(syncAllowed(schedule, new Date("2026-10-18T23:00Z")), true);
  assert.equal(syncAllowed(schedule, new Date("2026-10-19T05:59Z")), true);
  assert.equal(syncAllowed(schedule, new Date("2026-10-19T06:00Z")), false);
  assert.equal(syncAllowed(schedule, new Date("2026-10-19T23:00Z")), false);
});
test("equal times mean whole selected day and no days means paused", () => {
  const schedule = syncScheduleSchema.parse({
    mode: "scheduled",
    start: "09:00",
    end: "09:00",
    days: [1],
  });
  assert.equal(syncAllowed(schedule, new Date("2026-10-19T01:00Z")), true);
  assert.equal(
    syncAllowed({ ...schedule, days: [] }, new Date("2026-10-19T01:00Z")),
    false,
  );
});
test("invalid schedules are rejected", () => {
  for (const value of [
    { start: "24:00" },
    { end: "9:00" },
    { days: [0] },
    { timeZone: "Invalid/Zone" },
  ])
    assert.equal(syncScheduleSchema.safeParse(value).success, false);
});
