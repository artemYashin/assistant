import test from "node:test";
import assert from "node:assert/strict";
import { ignoredReviewPath, reviewFileSettings } from "../services/backend/src/review-files.js";
test("review paths match exact files, directory prefixes and glob patterns", () => {
  assert.ok(ignoredReviewPath("/src/api/client.ts", ["src/api/client.ts"]));
  assert.ok(ignoredReviewPath("/src/api/generated/client.ts", ["src/api/generated/"]));
  assert.ok(!ignoredReviewPath("/src/api/generated-other/client.ts", ["src/api/generated/"]));
  assert.ok(ignoredReviewPath("/src/api/client.generated.ts", ["**/*.generated.ts"]));
  assert.ok(ignoredReviewPath("/client.generated.ts", ["**/*.generated.ts"]));
  assert.ok(!ignoredReviewPath("/src/nested/file.ts", ["src/*.ts"]));
  assert.ok(ignoredReviewPath("/src/nested/file.ts", ["src/**/*.ts"]));
  assert.ok(ignoredReviewPath("/src/file.ts", ["src/**/*.ts"]));
  assert.ok(!ignoredReviewPath("/src/file.ts", []));
  assert.throws(() => reviewFileSettings.parse({ diffBudget: 1000000 }));
});
