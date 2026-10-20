import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { Connectors } from "../server/connectors.js";
import { IntegrationsAuth } from "../server/auth.js";
import { azureBrowseSchema, browseQuery } from "../server/azure-browser.js";
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
    queries = 0;
  t.mock.method(globalThis, "fetch", async (url: any, init: any) => {
    assert.equal(init.method, "POST");
    if (String(url).includes("/wiql?")) {
      queries++;
      assert.match(String(url), /\$top=51/);
      return Response.json({
        workItems: Array.from({ length: 51 }, (_, i) => ({ id: 100 - i })),
      });
    }
    assert.match(String(url), /\/workitemsbatch\?/);
    batches++;
    const body = JSON.parse(init.body);
    assert.ok(body.ids.length <= 50);
    assert.ok(!body.fields.includes("System.Description"));
    return Response.json({
      value: body.ids.map((id: number) => ({
        id,
        fields: {
          "System.TeamProject": "P",
          "System.Title": `Ticket ${id}`,
          "System.WorkItemType": "Bug",
          "System.State": "Active",
          "System.Tags": "a; b",
        },
      })),
    });
  });
  const result = await connectors.browseAzureTickets(
    azureBrowseSchema.parse({ source: store.source() }),
    [],
  );
  assert.equal(result.tickets.length, 50);
  assert.equal(result.next, 51);
  assert.equal(
    (store.db.prepare("SELECT count(*) AS n FROM tickets").get() as any).n,
    0,
  );
  assert.equal(queries, 1);
  assert.equal(batches, 1);
  const imported = await connectors.importAzureSelection(
    [100, 99],
    store.source(),
  );
  assert.deepEqual(imported.added, [100, 99]);
  assert.equal(batches, 2);
  await connectors.importAzureSelection([100, 99], store.source());
  assert.equal(batches, 2);
  assert.equal(
    (store.db.prepare("SELECT count(*) AS n FROM tickets").get() as any).n,
    2,
  );
  await assert.rejects(
    connectors.importAzureSelection([98], "wrong"),
    /изменилось/,
  );
  assert.equal(batches, 2);
});

test("exports mark local fields of unimported Azure tickets as unavailable", () => {
  const csv = ticketsCsv(
    [{ id: 1, imported: false }],
    ["priority", "tags", "developers", "notes", "added_at"],
  );
  assert.match(csv, /"N\/A";"N\/A";"N\/A";"N\/A";"N\/A"/);
});
