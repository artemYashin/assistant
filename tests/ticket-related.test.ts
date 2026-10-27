import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../services/backend/src/store.js";
import { Connectors } from "../services/backend/src/connectors.js";

test("related tickets read legacy cards, preserve links and unavailable rows, batch over 200 and guard source changes", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-related-"));
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
  store.setSecret("azure.pat", "fixture");
  const card = {
    id: 42,
    source: store.source(),
    fields: { "System.Title": "Saved" },
    comments: [],
  };
  store.db.prepare("INSERT INTO ticket_cards VALUES (?,?)").run("legacy", JSON.stringify(card));
  const service = new Connectors(store);
  let changed = false,
    fail = false;
  const batches: number[][] = [];
  t.mock.method(globalThis, "fetch", async (url: any, init: any) => {
    assert.ok(String(url).startsWith("https://ado.test/Collection/Project/_apis/wit/"));
    if (String(url).includes("workitemsbatch")) {
      const ids = JSON.parse(init.body).ids;
      batches.push(ids);
      assert.ok(JSON.parse(init.body).fields.includes("System.AssignedTo"));
      if (fail) return Response.json({ value: null });
      if (changed) store.set("settings", { ...store.settings(), azureProject: "Other" });
      return Response.json({
        value: ids
          .filter((id: number) => id !== 3)
          .map((id: number) => ({
            id,
            fields: {
              "System.Title": "Ticket " + id,
              "System.AssignedTo":
                id === 1 ? { displayName: "Ada Lovelace" } : id === 2 ? "Grace Hopper" : undefined,
              "System.State": "New",
              "System.WorkItemType": "Bug",
              "System.TeamProject": id === 2 ? "Other" : "Project",
            },
          })),
      });
    }
    return Response.json({
      id: 42,
      relations: [
        ...Array.from({ length: 201 }, (_, i) => ({
          rel: "System.LinkTypes.Hierarchy-Forward",
          url: "https://ado.test/Collection/_apis/wit/workitems/" + (i + 1),
        })),
        {
          rel: "System.LinkTypes.Hierarchy-Forward",
          url: "https://ado.test/Collection/_apis/wit/workitems/1",
        },
        { rel: "System.LinkTypes.Related", url: "https://evil.test/_apis/wit/workitems/999" },
        { rel: "AttachedFile", url: "https://ado.test/Collection/_apis/wit/attachments/8" },
      ],
    });
  });
  const data = await service.relatedTickets("legacy");
  assert.equal(data.items.length, 201);
  assert.deepEqual(
    batches.map((batch) => batch.length),
    [200, 1],
  );
  assert.equal(data.items[0].relation, "Дочерний");
  assert.equal(data.items[0].canOpen, true);
  assert.equal(data.items[0].assigned, "Ada Lovelace");
  assert.equal(data.items[1].assigned, "Grace Hopper");
  assert.equal(data.items[3].assigned, "");
  assert.equal(data.items[1].project, "Other");
  assert.equal(data.items[1].canOpen, false);
  assert.equal(data.items[2].unavailable, true);
  assert.deepEqual(service.ticketCard("legacy"), card);
  assert.equal((store.db.prepare("SELECT count(*) AS n FROM tickets").get() as { n: number }).n, 0);
  fail = true;
  await assert.rejects(service.relatedTickets("legacy"), /связанные тикеты/);
  fail = false;
  changed = true;
  await assert.rejects(service.relatedTickets("legacy"), /Подключение Azure изменилось/);
  assert.deepEqual(service.ticketCard("legacy"), card);
});
