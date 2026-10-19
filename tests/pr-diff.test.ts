import test from "node:test";
import assert from "node:assert/strict";
import { createTwoFilesPatch } from "diff";
import { splitDiff } from "../src/pr-diff.js";

test("side-by-side aligns replacements and preserves independent line numbers", () => {
  const patch = createTwoFilesPatch(
    "file.ts",
    "file.ts",
    "first\nold\nlast\n",
    "first\nnew\nextra\nlast\n",
  );
  const [file] = splitDiff([patch]);
  assert.equal(file.removed, 1);
  assert.equal(file.added, 2);
  const rows = file.hunks[0].rows;
  assert.deepEqual(rows[1], {
    kind: "change",
    left: { number: 2, text: "old" },
    right: { number: 2, text: "new" },
  });
  assert.deepEqual(rows[2], {
    kind: "change",
    left: undefined,
    right: { number: 3, text: "extra" },
  });
  assert.equal(rows[3].left?.number, 3);
  assert.equal(rows[3].right?.number, 4);
});
test("side-by-side supports added/deleted files, rename and literal HTML", () => {
  const [added, removed, renamed] = splitDiff([
    createTwoFilesPatch("new.ts", "new.ts", "", "<script>alert(1)</script>\n"),
    createTwoFilesPatch("old.ts", "old.ts", "deleted\n", ""),
    createTwoFilesPatch("before.ts", "after.ts", "same\n", "same\n"),
  ]);
  assert.equal(added.hunks[0].rows[0].left, undefined);
  assert.equal(added.hunks[0].rows[0].right?.text, "<script>alert(1)</script>");
  assert.equal(removed.hunks[0].rows[0].right, undefined);
  assert.equal(renamed.before, "before.ts");
  assert.equal(renamed.after, "after.ts");
  assert.equal(renamed.hunks.length, 0);
});
test("missing newline markers do not increment code line numbers", () => {
  const [file] = splitDiff([createTwoFilesPatch("a", "a", "old", "new")]);
  assert.equal(file.added, 1);
  assert.equal(file.removed, 1);
  assert.ok(file.hunks[0].rows.some((row) => row.kind === "notice"));
});
