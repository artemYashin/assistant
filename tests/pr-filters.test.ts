import test from "node:test";
import assert from "node:assert/strict";
import { filterPullRequests } from "../src/features/filter-pull-requests/index.js";
const items = [
  {
    number: 1,
    created_at: "2026-10-19T10:00:00Z",
    draft: 0,
    review_status: "completed",
  },
  {
    number: 9,
    created_at: "2026-10-17T10:00:00Z",
    draft: 1,
    review_status: "queued",
  },
  {
    number: 3,
    created_at: "2026-10-18T10:00:00Z",
    draft: 0,
    review_status: "error",
  },
  { number: 10, created_at: "", draft: 0 },
];
const filters = { draft: "all", review: "all", sort: "created:desc" };
test("creation order uses actual date rather than PR number; missing dates sort last", () => {
  assert.deepEqual(
    filterPullRequests(items, filters).map((p) => p.number),
    [1, 3, 9, 10],
  );
  assert.deepEqual(
    filterPullRequests(items, { ...filters, sort: "created:asc" }).map(
      (p) => p.number,
    ),
    [9, 3, 1, 10],
  );
  assert.deepEqual(
    items.map((p) => p.number),
    [1, 9, 3, 10],
  );
});
test("draft and current review readiness filters combine", () => {
  assert.deepEqual(
    filterPullRequests(items, {
      ...filters,
      draft: "published",
      review: "ready",
    }).map((p) => p.number),
    [1],
  );
  assert.deepEqual(
    filterPullRequests(items, { ...filters, draft: "draft", review: "ready" }),
    [],
  );
  assert.deepEqual(
    filterPullRequests(items, {
      ...filters,
      review: "pending",
      sort: "number:asc",
    }).map((p) => p.number),
    [3, 9, 10],
  );
});
