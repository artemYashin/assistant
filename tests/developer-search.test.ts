import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { Connectors } from "../server/connectors.js";
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
  const connectors = new Connectors(store);
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

test("empty general search falls back to explicit display name or mail, without enumerating users", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-search-fallback-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  store.set("settings", {
    ...store.settings(),
    azureUrl: "https://dev.azure.com/org",
    azureProject: "P",
  });
  store.setSecret("azure.pat", "pat");
  const connectors = new Connectors(store);
  const filters: string[] = [];
  t.mock.method(globalThis, "fetch", async (raw: any, init: any) => {
    const url = new URL(raw);
    assert.equal(init.method || "GET", "GET");
    assert.ok(url.searchParams.get("filterValue"));
    const filter = url.searchParams.get("searchFilter")!;
    filters.push(filter);
    return Response.json({
      value:
        filter === "General"
          ? []
          : [
              {
                id: "person",
                providerDisplayName: "Artem",
                properties: { Mail: { $value: "artem@example.test" } },
              },
            ],
    });
  });
  assert.equal((await connectors.developers("Artem")).users[0].name, "Artem");
  assert.equal(
    (await connectors.developers("artem@example.test")).users[0].email,
    "artem@example.test",
  );
  assert.deepEqual(filters, [
    "General",
    "DisplayName",
    "General",
    "MailAddress",
  ]);
});

test("partial-name Graph search resolves descriptors in one batch and excludes groups", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-partial-search-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  store.set("settings", {
    ...store.settings(),
    azureUrl: "https://dev.azure.com/org",
    azureProject: "P",
  });
  store.setSecret("azure.pat", "pat");
  const connectors = new Connectors(store);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (raw: any, init: any) => {
    calls++;
    const url = new URL(raw);
    if (url.pathname.endsWith("subjectquery")) {
      assert.equal(init.method, "POST");
      assert.deepEqual(JSON.parse(init.body), {
        query: "Art",
        subjectKind: ["User"],
      });
      return Response.json({
        value: [
          {
            subjectKind: "user",
            descriptor: "aad.person",
            originId: "entra-id",
          },
          { subjectKind: "group", descriptor: "group" },
        ],
      });
    }
    if (url.searchParams.has("subjectDescriptors")) {
      assert.equal(url.searchParams.get("subjectDescriptors"), "aad.person");
      return Response.json({
        value: [
          {
            id: "ado-id",
            providerDisplayName: "Artem Example",
            properties: { Mail: { $value: "artem@example.test" } },
          },
        ],
      });
    }
    assert.equal(url.searchParams.get("filterValue"), "Art");
    return Response.json({ value: [] });
  });
  const result = await connectors.developers("Art");
  assert.equal(calls, 4);
  assert.equal(result.users[0].id, "ado-id");
  assert.equal(result.warning, "");
});

test("unavailable Graph keeps cached partial-name results and reports a warning", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-partial-cache-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  store.set("settings", {
    ...store.settings(),
    azureUrl: "https://ado.test/Collection",
    azureProject: "P",
  });
  store.setSecret("azure.pat", "pat");
  const person = {
    id: "known",
    name: "Artem Example",
    email: "artem@example.test",
  };
  store.set("developers:" + store.source(), [
    person,
    { id: "other", name: "Other User" },
  ]);
  const connectors = new Connectors(store);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (raw: any) => {
    calls++;
    if (String(raw).includes("subjectquery"))
      return new Response("Not supported", { status: 404 });
    return Response.json({ value: [] });
  });
  const result = await connectors.developers("EXA art");
  assert.deepEqual(result.users, [person]);
  assert.match(result.warning, /локального кэша/);
  assert.match(result.warning, /HTTP 404/);
  assert.doesNotMatch(result.warning, /Graph: Read/);
  assert.equal(calls, 3);
  const missing = await connectors.developers("Unknown Person");
  assert.deepEqual(missing.users, []);
  assert.match(missing.warning, /онлайн-поиск не завершён/);
  assert.doesNotMatch(missing.warning, /Показаны ранее найденные/);
});
