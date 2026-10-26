import test from "node:test";
import assert from "node:assert/strict";
import { createTwoFilesPatch } from "diff";
import { splitDiff, diffFileSize } from "../src/pr-diff.js";

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

test("file sizes format bytes through gigabytes and preserve unknown sizes", () => {
  assert.equal(diffFileSize(), "—");
  assert.equal(diffFileSize(0), "0 Б");
  assert.equal(diffFileSize(1536), "1,5 КБ");
  assert.equal(diffFileSize(1024 ** 2), "1 МБ");
  assert.equal(diffFileSize(1024 ** 3), "1 ГБ");
});

test("skipped files retain paths and never pretend to contain empty text changes", async () => {
  const { displayDiffFiles } = await import("../src/pr-diff.js");
  const files = displayDiffFiles([], [
    {before:"/dev/null",after:"/large.ts",reason:"Too large"},
    {before:"/gone.bin",after:"/dev/null",reason:"Binary"},
    {before:"/old.ts",after:"/new.ts",reason:"Excluded"},
  ]);
  assert.equal(files.length, 3);
  assert.equal(files[0].skipReason, "Too large");
  assert.equal(files[1].before, "/gone.bin");
  assert.equal(files[2].after, "/new.ts");
  assert.ok(files.every(file => file.hunks.length === 0 && file.skipReason));
  assert.equal(displayDiffFiles([createTwoFilesPatch("/a", "/a", "old", "new")]).length, 1);
});
