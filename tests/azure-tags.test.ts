import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { Connectors } from "../server/connectors.js";
import { IntegrationsAuth } from "../server/auth.js";
import { listLocalTickets } from "../server/ticket-list.js";
import {
  saveTicketMetadata,
  ticketMetadata,
} from "../server/ticket-metadata.js";
import { editMetadataSchema } from "../server/ticket-metadata-tools.js";

test("Azure tags import, sync, search and trash lifecycle stay separate from local editable tags", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-azure-tags-"));
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
  store.setSecret("azure.pat", "pat");
  let tags: string | undefined = " API ; Customer ; API ; ";
  let requests = 0;
  t.mock.method(globalThis, "fetch", async (url: any, init: any) => {
    requests++;
    assert.match(String(url), /workitemsbatch/);
    assert.equal(init.method, "POST"); // Azure's batch read protocol, never PATCH.
    const body = JSON.parse(init.body);
    if (body.fields) assert.ok(body.fields.includes("System.Tags"));
    return Response.json({
      value: [
        {
          id: 42,
          fields: {
            "System.TeamProject": "Project",
            "System.Title": "Plain title",
            "System.WorkItemType": "Bug",
            "System.State": "Active",
            ...(tags === undefined ? {} : { "System.Tags": tags }),
          },
        },
      ],
    });
  });
  const connector = new Connectors(store, new IntegrationsAuth(store));
  await connector.importPrTickets([42]);
  assert.deepEqual(store.azureTags(42), ["API", "Customer"]);
  const context = { client: "C", project: "P" };
  saveTicketMetadata(store, 42, store.source(), context, { tags: ["Local"] });
  const page = listLocalTickets(store, { search: "customer", azureTag: "api" });
  assert.equal(page.total, 1);
  assert.deepEqual(page.tickets[0].azureTags, ["API", "Customer"]);
  assert.deepEqual(page.tickets[0].tags, ["Local"]);
  assert.equal(listLocalTickets(store, { tag: "API" }).total, 0);
  assert.deepEqual(store.azureTags(42, "other-source"), []);
  assert.equal(
    editMetadataSchema.safeParse({ id: 42, azureTags: ["Changed"] }).success,
    false,
  );
  assert.throws(() =>
    saveTicketMetadata(store, 42, store.source(), context, {
      azureTags: ["Changed"],
    }),
  );
  tags = "Updated";
  await connector.syncTickets();
  assert.deepEqual(store.azureTags(42), ["Updated"]);
  assert.deepEqual(ticketMetadata(store, 42).tags, ["Local"]);
  tags = undefined;
  await connector.syncTickets();
  assert.deepEqual(store.azureTags(42), []);
  assert.equal(listLocalTickets(store, { search: "Updated" }).total, 0);
  tags = "Retained";
  await connector.syncTickets();
  store.removeLocalTicket(42);
  assert.deepEqual(store.ticketTrash()[0].azureTags, ["Retained"]);
  store.restoreLocalTicket(42);
  assert.deepEqual(listLocalTickets(store, {}).tickets[0].azureTags, [
    "Retained",
  ]);
  store.removeLocalTicket(42);
  store.purgeTicketTrash(Date.now() + 31 * 86400000);
  assert.deepEqual(store.azureTags(42), []);
  assert.equal(requests, 4);
});
