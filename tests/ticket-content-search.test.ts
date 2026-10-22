import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listLocalTickets } from "../server/ticket-list.js";
import { Store } from "../server/store.js";
import { Connectors } from "../server/connectors.js";
import { IntegrationsAuth } from "../server/auth.js";
import { readCachedTicket, searchTicketContent } from "../server/ticket-content-search.js";

test("imports cache content, search is bounded/paged/source scoped, sync clears and trash expires", async t => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-content-"));
  const store = new Store(dir);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.set("settings", { ...store.settings(), azureUrl: "https://ado.test/Collection", azureProject: "Project" });
  const connector = new Connectors(store, new IntegrationsAuth(store));
  let description = "<p>" + "before ".repeat(100) + "Протокол обмена" + " after".repeat(100) + "</p>";
  (connector as any).azure = async (path: string, init: any) => {
    const ids = path === "workitemsbatch" ? JSON.parse(init.body).ids : [Number(path.split("/")[1])];
    const items = ids.map((id: number) => ({ id, fields: { "System.TeamProject": store.settings().azureProject, "System.Title": `Ticket ${id}`, ...(description ? { "System.Description": description } : {}) } }));
    return path === "workitemsbatch" ? { value: items } : items[0];
  };
  await connector.trackTicket(1); await connector.trackTicket(2);
  const detail = readCachedTicket(store, { id: 1 });
  assert.equal(detail.available, true);
  assert.ok(detail.content?.includes("Протокол обмена"));
  assert.deepEqual(detail.missingSections, ["criteria", "repro"]);
  assert.equal(readCachedTicket(store, { id: 999 }).available, false);
  const longText = "x".repeat(7500);
  store.db.prepare("UPDATE ticket_content_cache SET body=? WHERE source=? AND id=2").run(longText, store.source());
  let offset = 0, collected = "";
  do {
    const page = readCachedTicket(store, { id: 2, offset });
    collected += page.content;
    if (page.nextOffset === null) break;
    assert.ok(page.nextOffset! > offset);
    offset = page.nextOffset!;
  } while (true);
  assert.equal(collected, "description:\n" + longText);
  await connector.trackTicket(2);
  const first = searchTicketContent(store, { search: "ПРОТОКОЛ", limit: 1 });
  assert.equal(first.tickets[0].id, 1);
  assert.ok(first.tickets[0].snippet.length < 250);
  assert.equal(first.tickets[0].body, undefined);
  assert.equal(first.hasMore, true);
  assert.equal(searchTicketContent(store, { search: "протокол", afterId: first.nextAfterId }).tickets[0].id, 2);
  store.db.prepare("INSERT INTO ticket_content_cache VALUES (?,?,?,?,?,?)").run("other", 9, "description", "Протокол", "протокол", "now");
  assert.equal(searchTicketContent(store, { search: "протокол" }).tickets.length, 2);
  store.removeLocalTicket(1);
  assert.equal(searchTicketContent(store, { search: "протокол" }).tickets.length, 2);
  assert.equal(searchTicketContent(store, { search: "протокол", lifecycle: "active" }).tickets.length, 1);
  assert.equal(searchTicketContent(store, { search: "протокол", lifecycle: "deleted" }).tickets[0].deleted, true);
  assert.equal(readCachedTicket(store, { id: 1 }).available, true);
  assert.equal(listLocalTickets(store, { ids: [1] }).tickets[0].deleted, true);
  assert.equal(listLocalTickets(store, { lifecycle: "active" }).total, 1);
  assert.equal(listLocalTickets(store, { lifecycle: "deleted", search: "Ticket" }).total, 1);
  store.db.prepare("UPDATE ticket_trash SET removed_at=? WHERE id=1").run(Date.now() - 31 * 86400000);
  assert.equal(listLocalTickets(store, { ids: [1] }).total, 0);
  assert.equal(searchTicketContent(store, { search: "протокол", lifecycle: "deleted" }).tickets.length, 0);
  assert.ok(store.db.prepare("SELECT 1 FROM ticket_content_cache WHERE source=? AND id=1").get(store.source()));
  store.purgeTicketTrash(Date.now() + 31 * 86400000);
  assert.equal(store.db.prepare("SELECT 1 FROM ticket_content_cache WHERE source=? AND id=1").get(store.source()), undefined);
  description = "";
  await connector.syncTickets();
  assert.equal(searchTicketContent(store, { search: "протокол" }).tickets.length, 0);
  assert.equal(searchTicketContent(store, { search: "протокол" }).coverage.cached, 1);
});

test("content search includes current local notes without a body cache, with pagination and lifecycle isolation", t => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-notes-search-"));
  const store = new Store(dir);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const source = store.source();
  for (const id of [1, 2, 3]) {
    store.db.prepare("INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?,?)").run(source, id, `Ticket ${id}`, "Active", "", "Bug", "", "", "now");
    store.db.prepare("INSERT INTO ticket_metadata(source,id,notes) VALUES (?,?,?)")
      .run(source, id, "before ".repeat(100) + "ПРОТОКОЛ обмена" + " after".repeat(100));
  }
  store.db.prepare("INSERT INTO ticket_content_cache VALUES (?,?,?,?,?,?)")
    .run(source, 2, "description", "Протокол", "протокол", "now");
  store.db.prepare("INSERT INTO ticket_metadata(source,id,notes) VALUES (?,?,?)").run("other", 1, "секрет");
  store.db.prepare("INSERT INTO ticket_metadata(source,id,notes) VALUES (?,?,?)").run(source, 99, "протокол");
  const first = searchTicketContent(store, { search: "протокол", limit: 1 });
  assert.equal(first.tickets[0].id, 1);
  assert.equal(first.tickets[0].section, "notes");
  assert.ok(first.tickets[0].snippet.length < 250);
  assert.equal(first.hasMore, true);
  assert.equal(first.coverage.cached, 1);
  const rest = searchTicketContent(store, { search: "протокол", afterId: first.nextAfterId });
  assert.deepEqual(rest.tickets.map(row => row.id), [2, 3]);
  assert.equal(rest.hasMore, false);
  assert.equal(searchTicketContent(store, { search: "секрет" }).tickets.length, 0);
  assert.deepEqual(searchTicketContent(store, { search: "протокол", id: 3 }).tickets.map(row => row.id), [3]);
  store.removeLocalTicket(1);
  assert.equal(searchTicketContent(store, { search: "протокол", lifecycle: "deleted" }).tickets[0].section, "notes");
  assert.deepEqual(searchTicketContent(store, { search: "протокол", lifecycle: "active" }).tickets.map(row => row.id), [2, 3]);
  store.db.prepare("UPDATE ticket_metadata SET notes='новая заметка' WHERE source=? AND id=3").run(source);
  assert.equal(searchTicketContent(store, { search: "протокол", id: 3 }).tickets.length, 0);
  assert.equal(searchTicketContent(store, { search: "НОВАЯ", id: 3 }).tickets.length, 1);
});
