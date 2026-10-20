import test from "node:test";
import assert from "node:assert/strict";
import { paginationItems } from "../src/pagination.js";
test("numbered pagination retains endpoints and a bounded current-page window", () => {
  assert.deepEqual(paginationItems(1, 1), [1]);
  assert.deepEqual(paginationItems(2, 4), [1, 2, 3, 4]);
  assert.deepEqual(paginationItems(1, 20), [1, 2, 3, 4, 5, "gap-20", 20]);
  assert.deepEqual(paginationItems(10, 20), [
    1,
    "gap-8",
    8,
    9,
    10,
    11,
    12,
    "gap-20",
    20,
  ]);
  assert.deepEqual(paginationItems(20, 20), [1, "gap-16", 16, 17, 18, 19, 20]);
});
