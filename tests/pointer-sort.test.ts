import test from "node:test";
import assert from "node:assert/strict";
import { reorderOffsets } from "../services/frontend/src/shared/lib/pointer-sort/layout.js";

test("sorting mixed-height groups preserves spacing in both directions and at every target", () => {
  const heights = [36, 72, 36, 48, 36];
  const tops = [100, 142, 220, 262, 316];
  for (let from = 0; from < heights.length; from++) {
    for (let to = 0; to < heights.length; to++) {
      const offsets = reorderOffsets(tops, heights, from, to);
      const order = tops.map((_, i) => i);
      order.splice(to, 0, order.splice(from, 1)[0]);
      assert.equal(tops[order[0]] + offsets[order[0]], 100);
      for (let slot = 1; slot < order.length; slot++) {
        const previous = order[slot - 1],
          current = order[slot];
        assert.equal(
          tops[current] +
            offsets[current] -
            (tops[previous] + offsets[previous] + heights[previous]),
          6,
          `gap after moving ${from} to ${to}, slot ${slot}`,
        );
      }
      const last = order.at(-1)!;
      assert.equal(tops[last] + offsets[last] + heights[last], 352);
    }
  }
  assert.deepEqual(reorderOffsets(tops, heights, 1, 3), [0, 96, -78, -78, 0]);
});

test("equal-height lists and unchanged order retain their original layout", () => {
  assert.deepEqual(reorderOffsets([10, 52, 94], [36, 36, 36], 0, 2), [84, -42, -42]);
  assert.deepEqual(reorderOffsets([10, 52, 94], [36, 36, 36], 1, 1), [0, 0, 0]);
});
