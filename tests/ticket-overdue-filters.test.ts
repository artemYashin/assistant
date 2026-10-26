import test from "node:test";
import assert from "node:assert/strict";
import { parseTicketFilters } from "../services/frontend/src/features/filter-tickets/index.js";

test("overdue filter persists in presets, defaults off and rejects truthy strings", () => {
  assert.equal(parseTicketFilters({}).overdueDeadline, false);
  assert.equal(parseTicketFilters({ overdueDeadline: "false" }).overdueDeadline, false);
  const filters = parseTicketFilters({ overdueDeadline: true, stateFilter: ["Active"] });
  assert.deepEqual(parseTicketFilters(JSON.parse(JSON.stringify(filters))), filters);
  assert.equal(filters.overdueDeadline, true);
});
