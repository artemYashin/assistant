import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { Connectors } from "../server/connectors.js";
import { IntegrationsAuth } from "../server/auth.js";
import { azureBrowseSchema, browseQuery, orderBrowseIds } from "../server/azure-browser.js";
import { ticketsCsv } from "../src/tickets-csv.js";

test("Azure browsing escapes filters, uses ID cursors and intersects local filters", () => {
  const input = azureBrowseSchema.parse({
    source: "s",
    query: "Bob's task",
    before: 100,
    typeFilter: ["Bug", "Task"],
  });
  const query = browseQuery(input, [])!;
  assert.match(query, /Bob''s task/);
  assert.match(query, /\[System.Id\] < 100/);
  assert.match(query, /ORDER BY \[System.Id\] DESC/);
  assert.equal(browseQuery({ ...input, priorityFilter: ["1"] }, []), null);
  assert.match(
    browseQuery({ ...input, tagFilter: ["fix"] }, [
      { id: 12, tags: ["fix"] },
      { id: 13, tags: [] },
    ])!,
    /IN \(12\)/,
  );
  assert.match(
    browseQuery({ ...input, query: "#42" }, [])!,
    /\[System.Id\] = 42/,
  );
});

test("Azure sorting validates fields and preserves global ordering before pagination", () => {
  for (const [sort, field, direction] of [
    ["created_at-asc", "System.CreatedDate", "ASC"],
    ["changed_at-desc", "System.ChangedDate", "DESC"],
    ["title-asc", "System.Title", "ASC"],
  ]) {
    const query = browseQuery(azureBrowseSchema.parse({ source: "s", sort }), [])!;
    assert.ok(query.endsWith(`ORDER BY [${field}] ${direction}, [System.Id] DESC`));
  }
  assert.equal(azureBrowseSchema.safeParse({ source: "s", sort: "title-asc; DROP" }).success, false);
  assert.deepEqual(orderBrowseIds([3, 9, 1], "title-asc", []), [3, 9, 1]);
  const local = [{ id: 1, priority: 1 }, { id: 3, priority: 3 }];
  assert.deepEqual(orderBrowseIds([9, 3, 1], "priority-asc", local), [1, 3, 9]);
  assert.deepEqual(orderBrowseIds([9, 3, 1], "priority-desc", local), [3, 1, 9]);
});

test("Azure pages are bounded and read-only; selected imports use one read batch and deduplicate", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-azure-browser-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  store.set("settings", {
    ...store.settings(),
    azureUrl: "https://ado.test/Org",
    azureProject: "P",
  });
  store.setSecret("azure.pat", "pat");
  const connectors = new Connectors(store, new IntegrationsAuth(store));
  let batches = 0,
    queries = 0,
    resultCount = 51;
  t.mock.method(globalThis, "fetch", async (url: any, init: any) => {
    assert.equal(init.method, "POST");
    if (String(url).includes("/wiql?")) {
      queries++;
      assert.match(String(url), /\$top=20000/);
      return Response.json({
        workItems: Array.from({ length: resultCount }, (_, i) => ({
          id: 40000 - i,
        })),
      });
    }
    assert.match(String(url), /\/workitemsbatch\?/);
    batches++;
    const body = JSON.parse(init.body);
    assert.ok(body.ids.length <= 50);
    assert.ok(!body.fields.includes("System.Description"));
    return Response.json({
      value: [...body.ids].reverse().map((id: number) => ({
        id,
        fields: {
          "System.TeamProject": "P",
          "System.Title": `Ticket ${id}`,
          "System.WorkItemType": "Bug",
          "System.State": "Active",
          "System.Tags": "a; b",
          "System.CreatedDate": "2025-01-02T03:04:05Z",
          "System.ChangedDate": "2026-02-03T04:05:06Z",
        },
      })),
    });
  });
  const result = await connectors.browseAzureTickets(
    azureBrowseSchema.parse({ source: store.source() }),
    [],
  );
  assert.equal(result.tickets.length, 50);
  assert.equal(result.tickets[0].id, 40000);
  assert.equal(result.tickets[0].created_at, "2025-01-02T03:04:05Z");
  assert.equal(result.tickets[0].changed_at, "2026-02-03T04:05:06Z");
  assert.equal(result.total, 51);
  assert.equal(result.totalPages, 2);
  assert.equal(result.page, 1);
  assert.equal(
    (store.db.prepare("SELECT count(*) AS n FROM tickets").get() as any).n,
    0,
  );
  assert.equal(queries, 1);
  assert.equal(batches, 1);
  const second = await connectors.browseAzureTickets(
    azureBrowseSchema.parse({
      source: store.source(),
      snapshot: result.snapshot,
      page: 2,
    }),
    [],
  );
  assert.deepEqual(
    second.tickets.map((t: any) => t.id),
    [39950],
  );
  assert.equal(second.page, 2);
  assert.equal(queries, 1, "page changes reuse the ID snapshot");
  assert.equal(batches, 2);
  await assert.rejects(
    connectors.browseAzureTickets(
      azureBrowseSchema.parse({
        source: store.source(),
        snapshot: result.snapshot,
        query: "different",
      }),
      [],
    ),
    /устарели/,
  );
  await assert.rejects(
    connectors.browseAzureTickets(
      azureBrowseSchema.parse({ source: "wrong", snapshot: result.snapshot }),
      [],
    ),
    /изменилось/,
  );
  await assert.rejects(
    connectors.browseAzureTickets(
      azureBrowseSchema.parse({ source: store.source(), snapshot: result.snapshot, sort: "title-asc" }),
      [],
    ),
    /устарели/,
  );
  const imported = await connectors.importAzureSelection(
    [100, 99],
    store.source(),
  );
  assert.deepEqual([...imported.added].sort((a, b) => b - a), [100, 99]);
  assert.equal(store.ticketCreatedAt(100), "2025-01-02T03:04:05.000Z");
  assert.equal(batches, 3);
  await connectors.importAzureSelection([100, 99], store.source());
  assert.equal(batches, 3);
  assert.equal(
    (store.db.prepare("SELECT count(*) AS n FROM tickets").get() as any).n,
    2,
  );
  await assert.rejects(
    connectors.importAzureSelection([98], "wrong"),
    /изменилось/,
  );
  assert.equal(batches, 3);
  const empty = await connectors.browseAzureTickets(
    azureBrowseSchema.parse({
      source: store.source(),
      tagFilter: ["not-local"],
    }),
    [],
  );
  assert.equal(empty.total, 0);
  assert.equal(empty.totalPages, 1);
  assert.equal(queries, 1);
  resultCount = 20000;
  const capped = await connectors.browseAzureTickets(
    azureBrowseSchema.parse({ source: store.source(), page: 400 }),
    [],
  );
  assert.equal(capped.total, 20000);
  assert.equal(capped.totalPages, 400);
  assert.equal(capped.limited, true);
  assert.equal(capped.tickets.length, 50);
  assert.equal(queries, 2);
  const future = Date.now() + 16 * 60 * 1000;
  t.mock.method(Date, "now", () => future);
  await assert.rejects(
    connectors.browseAzureTickets(
      azureBrowseSchema.parse({
        source: store.source(),
        snapshot: capped.snapshot,
        page: 2,
      }),
      [],
    ),
    /устарели/,
  );
});

test("exports mark local fields of unimported Azure tickets as unavailable", () => {
  const csv = ticketsCsv(
    [{ id: 1, imported: false }],
    ["priority", "tags", "developers", "notes", "added_at"],
  );
  assert.match(csv, /"N\/A";"N\/A";"N\/A";"N\/A";"N\/A"/);
});
