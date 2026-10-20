import test from "node:test";
import assert from "node:assert/strict";
import {
  fitColumnWidths,
  parseColumnWidths,
  resizeColumnPair,
} from "../src/ticket-column-widths.js";

test("column width preferences reject invalid values and preserve valid dimensions", () => {
  assert.deepEqual(
    parseColumnWidths({
      title: 240,
      state: -1,
      tags: "100",
      assigned: Infinity,
    }),
    { title: 240 },
  );
  assert.deepEqual(parseColumnWidths([]), {});
});

test("manual column sizing fits the viewport and preserves preferences after hiding columns", () => {
  const saved = { id: 100, title: 300, tags: 100 };
  const wide = fitColumnWidths(
    ["selection", "id", "title", "tags"],
    saved,
    1044,
  );
  assert.equal(
    Object.values(wide).reduce((a, b) => a + b, 0),
    1044,
  );
  assert.equal(wide.selection, 44);
  assert.equal(wide.title / wide.id, 3);
  const narrow = fitColumnWidths(["selection", "id", "title"], saved, 444);
  assert.deepEqual(narrow, { selection: 44, id: 100, title: 300 });
  assert.deepEqual(saved, { id: 100, title: 300, tags: 100 });
});

test("resizing redistributes an adjacent pair without expanding the table", () => {
  const before = { id: 100, title: 300, tags: 100 };
  assert.deepEqual(resizeColumnPair(before, "title", "tags", 30), {
    id: 100,
    title: 330,
    tags: 70,
  });
  assert.deepEqual(resizeColumnPair(before, "title", "tags", 500), {
    id: 100,
    title: 340,
    tags: 60,
  });
  assert.deepEqual(resizeColumnPair(before, "title", "tags", -500), {
    id: 100,
    title: 120,
    tags: 280,
  });
  const narrow = resizeColumnPair({ title: 60, tags: 30 }, "title", "tags", 50);
  assert.deepEqual(narrow, { title: 60, tags: 30 });
});
