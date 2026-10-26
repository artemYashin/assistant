import test from "node:test";
import assert from "node:assert/strict";
import { diffFileLink } from "../services/frontend/src/entities/repository/index.js";
const data = { head: "a".repeat(40), base: "b".repeat(40) };
const context = { client: "Customer", project: "Project" };
test("diff links pin head for added/changed/renamed and base for deleted files", () => {
  for (const [before, after, path, revision] of [
    ["/dev/null", "src/new file.tsx", "src/new file.tsx", data.head],
    ["src/old.ts", "src/new.ts", "src/new.ts", data.head],
    ["src/deleted.ts", "/dev/null", "src/deleted.ts", data.base],
    ["/src/file.ts", "/src/file.ts", "src/file.ts", data.head],
  ]) {
    const url = new URL(
      diffFileLink({ before, after }, data, context, "refs/heads/feature/test")!,
      "https://orbit.test",
    );
    assert.equal(url.pathname, "/code");
    assert.equal(url.searchParams.get("path"), path);
    assert.equal(url.searchParams.get("revision"), revision);
    assert.equal(url.searchParams.get("branch"), "feature/test");
    assert.equal(url.searchParams.get("client"), context.client);
  }
});
test("missing revision/context and invalid paths cannot open a different revision", () => {
  assert.equal(diffFileLink({ before: "a", after: "a" }, { ...data, head: "" }, context), null);
  assert.equal(diffFileLink({ before: "a", after: "a" }, data, {}), null);
  assert.equal(diffFileLink({ before: "a", after: "../a" }, data, context), null);
  assert.equal(
    new URL(
      diffFileLink({ before: "a", after: "a" }, data, context)!,
      "https://orbit.test",
    ).searchParams.get("branch"),
    data.head,
  );
});
