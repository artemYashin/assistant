import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { getTicketCatalog } from "../server/ticket-catalog.js";
import { searchTicketContent } from "../server/ticket-content-search.js";
import { listLocalTickets } from "../server/ticket-list.js";

test("catalog and content filters include retained trash, isolate source and paginate filtered results", t => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-catalog-"));
  const store = new Store(dir);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const source = store.source();
  assert.equal(getTicketCatalog(store).azureCatalogCached, false);
  store.set("azure.ticket-options:" + source, [{ name: "Bug", states: ["New", "Active"] }, { name: "Task", states: ["New"] }]);
  for (const [id, type, state] of [[1, "Bug", "Active"], [2, "Bug", "Closed"], [3, "Task", "Active"], [4, "Bug", "Active"]] as const) {
    store.db.prepare("INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?,?)").run(source, id, "Ticket " + id, state, "A", type, "url", "", "today");
    store.db.prepare("INSERT INTO ticket_content_cache VALUES (?,?,?,?,?,?)").run(source, id, "description", "needle body", "needle body", "now");
  }
  store.removeLocalTicket(4);
  store.db.prepare("INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?,?)").run("other", 9, "Hidden", "Secret", "", "Hidden", "url", "", "today");
  assert.deepEqual(getTicketCatalog(store).types, [{ type: "Bug", states: ["Active", "Closed", "New"] }, { type: "Task", states: ["Active", "New"] }]);
  const filters = { search: "needle", type: "bug", state: "active", limit: 1, sortBy: "title", sortDirection: "desc" };
  const first = searchTicketContent(store, filters);
  assert.deepEqual(first.tickets.map(t => t.id), [4]);
  assert.deepEqual(first.coverage, { total: 2, cached: 2 });
  assert.equal(first.hasMore, true);
  assert.deepEqual(searchTicketContent(store, { ...filters, afterId: first.nextAfterId }).tickets.map(t => t.id), [1]);
  assert.deepEqual(searchTicketContent(store, { ...filters, lifecycle: "active" }).tickets.map(t => t.id), [1]);
  assert.equal(searchTicketContent(store, { ...filters, state: "Unknown" }).coverage.total, 0);
  assert.deepEqual(listLocalTickets(store, { type: "Bug", state: "Active" }).tickets.map(t => t.id), [1, 4]);
  // Notes-only tickets obey the same filters, even without a body cache.
  store.db.prepare("DELETE FROM ticket_content_cache WHERE source=? AND id=1").run(source);
  store.db.prepare("INSERT INTO ticket_metadata(source,id,notes) VALUES (?,?,?)").run(source, 1, "needle note");
  assert.equal(searchTicketContent(store, { ...filters, lifecycle: "active" }).tickets[0].section, "notes");
});

test("multi-value filters combine OR within each field and AND across fields, including pagination and notes", t => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-multifilter-"));
  const store = new Store(dir);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const source = store.source();
  for (const [id, type, state] of [[1,"Bug","New"],[2,"Task","Active"],[3,"Bug","Closed"],[4,"Story","Active"],[5,"Task","New"]] as const) {
    store.db.prepare("INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?,?)").run(source,id,"Ticket "+id,state,"",type,"","","now");
    store.db.prepare("INSERT INTO ticket_metadata(source,id,notes) VALUES (?,?,?)").run(source,id,"needle note");
  }
  store.removeLocalTicket(5);
  store.db.prepare("INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?,?)").run("foreign",6,"Other","New","","Bug","","","now");
  const filters = { type: [" bug ", "Task", "Bug"], state: ["new","Active"], limit: 2 };
  const first = listLocalTickets(store, filters);
  assert.equal(first.total,3);
  assert.deepEqual(first.tickets.map(t=>t.id),[1,2]);
  assert.deepEqual(listLocalTickets(store,{...filters,afterId:first.nextAfterId}).tickets.map(t=>t.id),[5]);
  assert.deepEqual(listLocalTickets(store,{...filters,lifecycle:"active"}).tickets.map(t=>t.id),[1,2]);
  const content = searchTicketContent(store,{...filters,search:"needle"});
  assert.deepEqual(content.tickets.map(t=>t.id),[1,2]);
  assert.deepEqual(content.coverage,{total:3,cached:0});
  assert.deepEqual(searchTicketContent(store,{...filters,search:"needle",afterId:content.nextAfterId}).tickets.map(t=>t.id),[5]);
  assert.equal(listLocalTickets(store,{type:[],state:[]}).total,5);
  assert.equal(searchTicketContent(store,{search:"needle",type:[],state:[]}).coverage.total,5);
  assert.equal(listLocalTickets(store,{type:["Unknown", "Bug') OR 1=1 --"]}).total,0);
  assert.equal(searchTicketContent(store,{search:"needle",state:["Unknown"]}).tickets.length,0);
  assert.deepEqual(listLocalTickets(store,{type:"Task",state:["Active","Closed"]}).tickets.map(t=>t.id),[2]);
});
