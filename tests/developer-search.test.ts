import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { Connectors } from "../server/connectors.js";
import { IntegrationsAuth } from "../server/auth.js";
test("identity search is filtered, bounded, excludes groups and merges cached search selections", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-search-")),
    store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  store.set("settings", {
    ...store.settings(),
    azureUrl: "https://dev.azure.com/org",
    azureProject: "Project",
  });
  store.setSecret("azure.pat", "pat");
  const connectors = new Connectors(store, new IntegrationsAuth(store));
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (raw: any) => {
    calls++;
    const url = new URL(raw);
    assert.equal(url.origin, "https://vssps.dev.azure.com");
    assert.equal(url.pathname, "/org/_apis/identities");
    assert.equal(url.searchParams.get("searchFilter"), "General");
    assert.equal(url.searchParams.get("filterValue"), "Ann & dev");
    return Response.json({
      value: [
        { id: "group", isContainer: true },
        { id: "inactive", isActive: false },
        ...Array.from({ length: 25 }, (_, i) => ({
          id: `id-${i}`,
          providerDisplayName: `Ann ${i}`,
          properties: { Mail: { $value: `ann${i}@test` } },
        })),
      ],
    });
  });
  await assert.rejects(connectors.developers(""));
  await assert.rejects(connectors.developers("**"));
  assert.equal(calls, 0);
  store.set("developers:" + store.source(), [
    { id: "previous", name: "Previous" },
  ]);
  const result = await connectors.developers("Ann & dev");
  assert.equal(calls, 1);
  assert.equal(result.users.length, 20);
  assert.equal(result.truncated, true);
  assert.equal(result.users[0].email, "ann0@test");
  assert.ok(
    store
      .get<any[]>("developers:" + store.source(), [])
      .some((u) => u.id === "previous"),
  );
  t.mock.method(globalThis, "fetch", async () => {
    store.set("settings", { ...store.settings(), azureProject: "Other" });
    return Response.json({ value: [] });
  });
  await assert.rejects(connectors.developers("Ann"), /изменилось/);
});
