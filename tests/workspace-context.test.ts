import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { LocalDevelopers } from "../server/local-developers.js";
import { workspaceContext } from "../server/workspace-context.js";
test("workspace context exposes scoped developers, registry and repository settings without secrets", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-context-")),
    store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const context = { client: "Client", project: "Project" };
  store.addContext(context);
  store.setSecret("azure.pat", "TOP-SECRET");
  const devs = new LocalDevelopers(store);
  devs.add(["General"], { client: "", project: "" });
  devs.add(["Client Dev"], { client: "Client", project: "" });
  devs.add(["Project Dev"], context);
  devs.add(["Other Dev"], { client: "Other", project: "Other" });
  store.db
    .prepare(
      "INSERT INTO pr_projects(id,client,project,source,azure_project,repository,mode,enabled) VALUES ('m','Client','Project','https://ado.test','Azure Project','Repo','all',1)",
    )
    .run();
  const data = workspaceContext(store, context);
  assert.deepEqual(data.developers.map((d) => d.name).sort(), [
    "Client Dev",
    "General",
    "Project Dev",
  ]);
  assert.equal((data.repositories[0] as any).repository, "Repo");
  assert.ok(data.contexts.some((c) => c.project === "Project"));
  assert.ok(!JSON.stringify(data).includes("TOP-SECRET"));
  devs.add(
    Array.from({ length: 25 }, (_, i) => `Dev ${i}`),
    context,
  );
  const first = workspaceContext(store, context);
  assert.equal(first.developers.length, 10);
  assert.equal(first.nextOffset, 10);
  assert.equal(workspaceContext(store, context, 20).developers.length, 8);
});
