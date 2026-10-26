import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../services/backend/src/store.js";
import { PullRequests } from "../services/backend/src/pull-requests.js";
import { PrCreate } from "../services/backend/src/pr-create.js";
test("PR creation validates branches, scopes repository, sends only PR fields and detects duplicates", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-create-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  store.set("settings", {
    ...store.settings(),
    azureUrl: "https://ado.test/collection",
    azureProject: "Project",
  });
  store.setSecret("azure.pat", "pat");
  const prs = new PullRequests(store, {
    active: () => null,
    chat: async () => ({ body: "", requestId: "" }),
  });
  prs.save({
    client: "A",
    project: "B",
    repository: "repo",
    mode: "all",
    enabled: true,
  });
  const service = new PrCreate(store),
    monitor = prs.monitors()[0].id;
  let branchReads = 0;
  let writes = 0,
    existing = false;
  t.mock.method(globalThis, "fetch", async (raw: any, init: any) => {
    const url = new URL(String(raw));
    assert(url.pathname.startsWith("/collection/Project/_apis/git/repositories/repo/"));
    let data: any;
    if (init.method === "POST") {
      writes++;
      assert.deepEqual(JSON.parse(init.body), {
        sourceRefName: "refs/heads/feature",
        targetRefName: "refs/heads/main",
        title: "Title",
        description: "Description",
        isDraft: true,
      });
      data = { pullRequestId: 42 };
    } else if (url.pathname.endsWith("/refs")) {
      const f = url.searchParams.get("filter");
      if (f === "heads/") {
        branchReads++;
        assert.equal(url.searchParams.get("filterContains"), "feature");
        assert.equal(url.searchParams.get("$top"), "100");
      }
      data = {
        value: f === "heads/" ? [{ name: "refs/heads/feature" }] : [{ name: "refs/" + f }],
      };
    } else data = { value: existing ? [{ pullRequestId: 42 }] : [] };
    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json" },
    });
  });
  assert.deepEqual((await service.branches(monitor, "feature")).branches, ["refs/heads/feature"]);
  await service.branches(monitor, "feature");
  assert.equal(branchReads, 2, "repeated search reads Azure again");
  const input = {
    monitor,
    source: "refs/heads/feature",
    target: "refs/heads/main",
    title: "Title",
    description: "Description",
    draft: true,
  };
  await assert.rejects(service.create({ ...input, target: input.source }));
  assert.equal(writes, 0);
  assert.deepEqual(await service.create(input), {
    number: 42,
    existing: false,
  });
  assert.equal(writes, 1);
  existing = true;
  assert.deepEqual(await service.create(input), { number: 42, existing: true });
  assert.equal(writes, 1);
  store.set("settings", { ...store.settings(), azureProject: "Changed" });
  await assert.rejects(service.create(input));
  assert.equal(writes, 1);
});
