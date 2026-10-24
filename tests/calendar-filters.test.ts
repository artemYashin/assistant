import test from "node:test";
import assert from "node:assert/strict";
import { parseCalendarFilters } from "../src/calendar-filters.js";
test("reminder preset roundtrip keeps every filter and wall-clock date", () => {
 const filters = { clientFilter: "=Customer", projectFilter: '["Customer","Project"]', status: "overdue", query: "deadline", from: "2026-10-24T12:30", to: "2026-10-26T15:00", sort: "desc" };
 assert.deepEqual(parseCalendarFilters(JSON.parse(JSON.stringify(filters))), filters);
});
test("invalid saved reminder filters reset safely without leaking ticket filter fields", () => {
 assert.deepEqual(parseCalendarFilters({status:"bogus",sort:"bogus",query:123,from:"not-a-date",priority:[1]}), parseCalendarFilters(null));
});
