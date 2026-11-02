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
});

test("diff budget accepts values above the former cap and preserves validation/defaults", () => {
  assert.equal(reviewFileSettings.parse({}).diffBudget, 160000);
  for (const diffBudget of [40000, 160000, 400000, 1000000, 2000000])
    assert.equal(reviewFileSettings.parse({ diffBudget }).diffBudget, diffBudget);
  for (const diffBudget of [39999, 1000000.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => reviewFileSettings.parse({ diffBudget }));
});

test("larger saved budgets survive restart and are used without resetting existing rules", async (t) => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { Store } = await import("../services/backend/src/store.js");
  const { PullRequests } = await import("../services/backend/src/pull-requests.js");
  const directory = mkdtempSync(join(tmpdir(), "orbit-diff-budget-"));
  let store = new Store(directory);
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const agent = { active: () => null, chat: async () => ({ body: "", requestId: "" }) };
  let service = new PullRequests(store, agent);
  store.set("settings", {
    ...store.settings(),
    azureUrl: "https://dev.azure.com/example",
    azureProject: "Project",
  });
  store.setSecret("azure.pat", "fixture");
  const input = {
    client: "Client",
    project: "Project",
    repository: "repo",
    enabled: true,
    mode: "all" as const,
  };
  const rules = { ignoredPaths: ["generated/"], diffBudget: 80000 };
  service.save({ ...input, reviewFiles: rules });
  const original = service.monitors()[0];
  store.close();
  store = new Store(directory);
  service = new PullRequests(store, agent);
  assert.equal(service.monitors()[0].id, original.id);
  assert.deepEqual(JSON.parse(service.monitors()[0].review_files!), rules);
  const larger = { ...rules, diffBudget: 1000000 };
  service.save({ ...input, reviewFiles: larger });
  store.close();
  store = new Store(directory);
  service = new PullRequests(store, agent);
  // An older form omitting reviewFiles must preserve the newly saved budget.
  service.save(input);
  const monitor = service.monitors()[0];
  assert.equal(monitor.id, original.id);
  assert.deepEqual(JSON.parse(monitor.review_files!), larger);
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ commonCommit: "base", changes: [], allChangesIncluded: true }),
  );
  const result = await service.changes(monitor, "repo", "head", "target");
  assert.equal(result.limits.totalCharacters, 1000000);
  assert.equal(result.limits.perFileCharacters, 250000);
  assert.deepEqual(result.diagnostics.rules, rules.ignoredPaths);
});
