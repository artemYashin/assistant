import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../services/backend/src/store.js";
import { Connectors } from "../services/backend/src/connectors.js";
import {
  cachedChildIds,
  childTicketIds,
  saveChildIds,
} from "../services/backend/src/ticket-children.js";
import { saveTicketMetadata, ticketMetadata } from "../services/backend/src/ticket-metadata.js";
const base = "https://ado.test/Org";
const relation = (id: number, rel = "System.LinkTypes.Hierarchy-Forward") => ({
  rel,
  url: `${base}/_apis/wit/workitems/${id}`,
});
const item = (id: number, children: number[] = []) => ({
  id,
  fields: {
    "System.TeamProject": "P",
    "System.Title": `Ticket ${id}`,
    "System.WorkItemType": "Bug",
    "System.State": "New",
  },
  relations: children.map((id) => relation(id)),
});
function setup(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-children-"));
  const store = new Store(dir);
  store.set("settings", { ...store.rawSettings(), azureUrl: base, azureProject: "P" });
  store.setSecret("azure.pat", "test-pat");
  const previous = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = previous;
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { store, source: store.source(), service: new Connectors(store), dir };
}
test("only direct children from same collection; duplicate, self and reverse links ignored", () => {
  assert.deepEqual(
    childTicketIds(
      {
        id: 1,
        relations: [
          relation(2),
          relation(2),
          relation(1),
          relation(3, "System.LinkTypes.Hierarchy-Reverse"),
          { ...relation(4), url: "https://other.test/_apis/wit/workitems/4" },
        ],
      },
      base,
    ),
    [2],
  );
});
test("sync saves and clears children atomically without importing them", async (t) => {
  const { store, source, service } = setup(t);
  store.db.prepare("INSERT INTO tickets VALUES (?,1,'Root','New','','Bug','','','')").run(source);
  let children = [2, 3];
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    assert.equal(request.$expand, "Relations");
    assert.equal(request.fields, undefined);
    return Response.json({ value: [item(1, children)] });
  };
  await service.syncTickets();
  assert.deepEqual(cachedChildIds(store, source, 1), [2, 3]);
  assert.equal((store.db.prepare("SELECT COUNT(*) n FROM tickets").get() as any).n, 1);
  children = [];
  await service.syncTickets();
  assert.deepEqual(cachedChildIds(store, source, 1), []);
});
test("lazy summary and expanded children preserve local and trash data; no implicit import", async (t) => {
  const { store, source, service } = setup(t);
  store.db.prepare("INSERT INTO tickets VALUES (?,2,'Local','New','','Bug','','','')").run(source);
  saveTicketMetadata(
    store,
    2,
    source,
    { client: "", project: "" },
    { priority: 7, tags: ["keep"] },
  );
  store.removeLocalTicket(2);
  const trash = store.ticketTrash();
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    const request = JSON.parse(String(init?.body));
    return Response.json({
      value: request.$expand ? [item(1, [2, 3, 4]), item(5, [3])] : [item(2), item(3)],
    });
  };
  const summary = await service.ticketChildren({ source, ids: [1, 5], includeChildren: false });
  assert.equal(calls, 1);
  assert.deepEqual(
    summary.parents.map((p) => p.childIds),
    [[2, 3, 4], [3]],
  );
  const result = await service.ticketChildren(
    { source, ids: [1, 5], includeChildren: true },
    trash,
  );
  assert.equal(calls, 2);
  const rows = (result.parents[0] as any).children;
  assert.equal(rows[0].inTrash, true);
  assert.equal(rows[0].priority, 7);
  assert.deepEqual(rows[0].tags, ["keep"]);
  assert.equal(rows[1].imported, false);
  assert.equal(rows[2].unavailable, true);
  assert.equal((result.parents[1] as any).children[0].id, 3);
  assert.equal((store.db.prepare("SELECT COUNT(*) n FROM tickets").get() as any).n, 0);
  assert.equal(store.ticketTrash()[0].removedAt, trash[0].removedAt);
});
test("children fetch chunks beyond 200; does not follow grandchildren", async (t) => {
  const { store, source, service } = setup(t);
  const ids = Array.from({ length: 201 }, (_, i) => i + 2);
  saveChildIds(store, source, item(1, ids), base);
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    assert.ok(body.ids.length <= 200);
    return Response.json({ value: body.ids.map((id: number) => item(id, [999])) });
  };
  const result = await service.ticketChildren({ source, ids: [1], includeChildren: true });
  assert.equal(calls, 2);
  assert.equal((result.parents[0] as any).children.length, 201);
  assert.equal(cachedChildIds(store, source, 2), undefined);
});
test("failed or mismatched source reads retain previous cache", async (t) => {
  const { store, source, service } = setup(t);
  saveChildIds(store, source, item(1, [2]), base);
  await assert.rejects(
    service.ticketChildren({ source: "other", ids: [1], includeChildren: true }),
    /Подключение/,
  );
  globalThis.fetch = async () => Response.json({ value: null });
  await assert.rejects(
    service.ticketChildren({ source, ids: [1], includeChildren: true }),
    /Azure/,
  );
  assert.deepEqual(cachedChildIds(store, source, 1), [2]);
});
test("additive upgrade and repeated startup preserve populated metadata and trash", (t) => {
  const { store, source, dir } = setup(t);
  store.db.prepare("INSERT INTO tickets VALUES (?,2,'Local','New','','Bug','','','')").run(source);
  saveTicketMetadata(
    store,
    2,
    source,
    { client: "", project: "" },
    { priority: 7, tags: ["keep"] },
  );
  store.removeLocalTicket(2);
  store.db.exec("DROP TABLE ticket_children_cache");
  const upgraded = new Store(dir);
  assert.equal(cachedChildIds(upgraded, source, 2), undefined);
  assert.deepEqual(ticketMetadata(upgraded, 2, source).tags, ["keep"]);
  assert.equal(upgraded.ticketTrash()[0].id, 2);
  saveChildIds(upgraded, source, item(1, [2]), base);
  upgraded.close();
  const repeated = new Store(dir);
  assert.deepEqual(cachedChildIds(repeated, source, 1), [2]);
  assert.equal(repeated.ticketTrash()[0].id, 2);
  repeated.close();
});

test("malformed sync response preserves previous edges and ticket contents", async (t) => {
  const { store, source, service } = setup(t);
  store.db
    .prepare("INSERT INTO tickets VALUES (?,1,'Original','New','','Bug','','','')")
    .run(source);
  saveChildIds(store, source, item(1, [2]), base);
  globalThis.fetch = async () => Response.json({ value: [{ ...item(1), relations: {} }] });
  await assert.rejects(service.syncTickets(), /Azure/);
  assert.deepEqual(cachedChildIds(store, source, 1), [2]);
  assert.equal(
    (store.db.prepare("SELECT title FROM tickets WHERE id=1").get() as any).title,
    "Original",
  );
});

test("project switch during children loading rejects stale response without saving links", async (t) => {
  const { store, source, service } = setup(t);
  globalThis.fetch = async () => {
    store.set("settings", { ...store.rawSettings(), azureProject: "Other" });
    return Response.json({ value: [item(1, [2])] });
  };
  await assert.rejects(
    service.ticketChildren({ source, ids: [1], includeChildren: false }),
    /Подключение/,
  );
  assert.equal(cachedChildIds(store, source, 1), undefined);
});

test("explicit forceRefresh replaces cached parent edges but failure retains them", async (t) => {
  const { store, source, service } = setup(t);
  saveChildIds(store, source, item(1, [2]), base);
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ value: [item(1, [3])] });
  };
  await service.ticketChildren({ source, ids: [1], includeChildren: false });
  assert.equal(calls, 0);
  const result = await service.ticketChildren({
    source,
    ids: [1],
    includeChildren: false,
    forceRefresh: true,
  });
  assert.equal(calls, 1);
  assert.deepEqual(result.parents[0].childIds, [3]);
  globalThis.fetch = async () => Response.json({ value: null });
  await assert.rejects(
    service.ticketChildren({ source, ids: [1], includeChildren: false, forceRefresh: true }),
    /Azure/,
  );
  assert.deepEqual(cachedChildIds(store, source, 1), [3]);
});

test("sync rejects connection changes before persisting fetched rows or edges", async (t) => {
  const { store, source, service } = setup(t);
  store.db
    .prepare("INSERT INTO tickets VALUES (?,1,'Original','New','','Bug','','','')")
    .run(source);
  saveChildIds(store, source, item(1, [2]), base);
  globalThis.fetch = async () => {
    store.setSecret("azure.pat", "changed-pat");
    return Response.json({ value: [item(1, [3])] });
  };
  await assert.rejects(service.syncTickets(), /Подключение/);
  assert.deepEqual(cachedChildIds(store, source, 1), [2]);
  assert.equal(
    (store.db.prepare("SELECT title FROM tickets WHERE id=1").get() as any).title,
    "Original",
  );
});
