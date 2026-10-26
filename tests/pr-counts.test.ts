import test from "node:test";
import assert from "node:assert/strict";
import { countPrFiles, countPrCommits } from "../services/backend/src/pr-counts.js";
test("file counts paginate metadata, exclude folders and deduplicate paths", async () => {
  const skips: number[] = [];
  const result = await countPrFiles(async (skip) => {
    skips.push(skip);
    return skip === 0
      ? {
          commonCommit: "base",
          changes: [{ item: { path: "/folder", isFolder: true } }, { item: { path: "/a" } }],
        }
      : {
          commonCommit: "base",
          allChangesIncluded: true,
          changes: [{ item: { path: "/a" } }, { item: { path: "/b" }, changeType: "delete" }],
        };
  });
  assert.deepEqual(skips, [0, 2]);
  assert.deepEqual(result, { value: 2, complete: true });
});
test("commits follow continuation tokens and count unique IDs", async () => {
  const tokens: string[] = [];
  const result = await countPrCommits(async (token) => {
    tokens.push(token);
    return {
      body: { value: token ? [{ commitId: "a" }, { commitId: "b" }] : [{ commitId: "a" }] },
      continuationToken: token ? "" : "next",
    };
  });
  assert.deepEqual(tokens, ["", "next"]);
  assert.deepEqual(result, { value: 2, complete: true });
});
test("partial counts are explicit and malformed pagination is not reported as exact", async () => {
  const result = await countPrFiles(async (skip) => ({
    commonCommit: "base",
    changes: [{ item: { path: `/${skip}` } }],
  }));
  assert.deepEqual(result, { value: 20, complete: false });
  await assert.rejects(countPrFiles(async () => ({ commonCommit: "base", changes: [] })));
  await assert.rejects(
    countPrCommits(async () => ({ body: { value: [] }, continuationToken: "same" })),
  );
  assert.deepEqual(
    await countPrFiles(async () => ({
      commonCommit: "base",
      changes: [],
      allChangesIncluded: true,
    })),
    { value: 0, complete: true },
  );
});
