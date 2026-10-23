import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  extractTicketIds,
  Connectors,
  plainText,
} from "../server/connectors.js";
import { Store } from "../server/store.js";
import { azureBase } from "../server/http.js";

test("ticket recognition handles Azure links, Russian, AB# and deduplication", () => {
  assert.deepEqual(
    extractTicketIds(
      "AB#123, #123, тикет №456, bug 789, https://ado/Collection/P/_workitems/edit/987",
    ),
    [123, 456, 789, 987],
  );
  assert.deepEqual(
    extractTicketIds("2026-10-19 meeting at 12345, release 2026, &#123;"),
    [2026, 10, 19, 12345],
  );
  assert.equal(plainText("<p>Hello &amp; <b>world</b></p>"), "Hello & world");
});
test("custom Azure HTTPS collection paths are retained and credential-bearing URLs rejected", () => {
  assert.equal(
    azureBase("https://devops.company.test/tfs/CustomCollection/"),
    "https://devops.company.test/tfs/CustomCollection",
  );
  for (const url of [
    "http://host/collection",
    "https://user:password@host/",
    "https://host/?token=secret",
    "https://host/#x",
    "not-url",
  ])
    assert.throws(() => azureBase(url));
});

test("Azure adapter uses custom collection, PAT header, project, API version and persists real fields", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-azure-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  store.set("settings", {
    ...store.settings(),
    azureUrl: "https://ado.company.test/tfs/Collection",
    azureProject: "Project One",
    azureVersion: "7.0",
  });
  store.setSecret("azure.pat", "test-pat");
  const calls: { url: string; init: any }[] = [];
  t.mock.method(globalThis, "fetch", async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    return new Response(
      JSON.stringify({
        id: 321,
        fields: {
          "System.Title": "Fix login",
          "System.State": "Active",
          "System.TeamProject": "Project One",
          "System.AssignedTo": { displayName: "Tester" },
          "System.WorkItemType": "Bug",
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
  const connectors = new Connectors(store);
  await connectors.trackTicket(321);
  assert.equal(
    calls[0].url,
    "https://ado.company.test/tfs/Collection/Project%20One/_apis/wit/workitems/321?api-version=7.0",
  );
  assert.equal(
    calls[0].init.headers.Authorization,
    `Basic ${Buffer.from(":test-pat").toString("base64")}`,
  );
  const ticket = store.db
    .prepare("SELECT * FROM tickets WHERE id=321")
    .get() as any;
  assert.equal(ticket.title, "Fix login");
  assert.equal(ticket.assigned, "Tester");
  assert.equal(ticket.state, "Active");
  assert.equal(
    ticket.url,
    "https://ado.company.test/tfs/Collection/Project%20One/_workitems/edit/321",
  );
});

test("changing Azure settings during a request does not relabel the response as another project", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-source-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const original = {
    ...store.settings(),
    azureUrl: "https://ado.test/One",
    azureProject: "Project A",
  };
  store.set("settings", original);
  store.setSecret("azure.pat", "test");
  t.mock.method(globalThis, "fetch", async () => {
    store.set("settings", {
      ...original,
      azureUrl: "https://ado.test/Two",
      azureProject: "Project B",
    });
    return new Response(
      JSON.stringify({
        id: 1,
        fields: {
          "System.Title": "A ticket",
          "System.TeamProject": "Project A",
        },
      }),
    );
  });
  await assert.rejects(
    new Connectors(store).trackTicket(1),
    /Подключение Azure изменилось/,
  );
  assert.equal(store.db.prepare("SELECT * FROM tickets").get(), undefined);
});

test("bare IDs of any length and numbers anywhere in URLs are candidates", () => {
  assert.deepEqual(
    extractTicketIds(
      "Проверь 123456 и 1234567, ещё 42, 00042, 0, 9007199254740992",
    ),
    [123456, 1234567, 42],
  );
  assert.deepEqual(
    extractTicketIds(
      "https://ado/custom/item123456/details https://ado/view?id=7654321 https://ado/issue/234567#details",
    ),
    [7654321, 234567, 123456],
  );
  assert.deepEqual(
    extractTicketIds(
      "<p data-id='999999'>Смотри <a href='https://ado/view?id=%31%32%33%34%35%36&amp;view=full'>открыть</a></p>",
    ),
    [123456],
  );
  assert.deepEqual(
    extractTicketIds(
      '&#123; &#x7b; <span style="font-size:123456px">текст</span>',
    ),
    [],
  );
  assert.deepEqual(extractTicketIds("https://ado/123456/%broken"), [123456]);
});

test("bare candidates are not tracked until Azure validates existence and project", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-candidate-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  store.set("settings", {
    ...store.settings(),
    azureUrl: "https://ado.test/Collection",
    azureProject: "Project",
  });
  store.setSecret("azure.pat", "test");
  const connectors = new Connectors(store);
  let mode = "missing";
  t.mock.method(globalThis, "fetch", async () =>
    mode === "missing"
      ? new Response("", { status: 404 })
      : new Response(
          JSON.stringify({
            id: 123456,
            fields: {
              "System.TeamProject": mode === "wrong" ? "Other" : "Project",
              "System.Title": "Task",
            },
          }),
          { status: 200 },
        ),
  );
  await assert.rejects(connectors.trackTicket(123456), /404/);
  mode = "wrong";
  await assert.rejects(connectors.trackTicket(123456), /другому проекту/);
  assert.equal(
    (store.db.prepare("SELECT count(*) n FROM tickets").get() as any).n,
    0,
  );
  mode = "valid";
  await connectors.trackTicket(123456);
  assert.equal(
    (store.db.prepare("SELECT id FROM tickets").get() as any).id,
    123456,
  );
});
