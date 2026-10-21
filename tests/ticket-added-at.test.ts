import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { listLocalTickets } from "../server/ticket-list.js";
function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-added-at-"));
  let store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    get store() {
      return store;
    },
    reopen() {
      store.close();
      store = new Store(dir);
      return store;
    },
  };
}
function insert(store: Store, id: number, source = store.source()) {
  store.db
    .prepare(
      "INSERT INTO tickets VALUES (?,?,'Title','Active','','Bug','https://ado.test','old-change','old-sync') ON CONFLICT(source,id) DO UPDATE SET synced_at='new-sync'",
    )
    .run(source, id);
}
test("first local addition is captured once and survives sync, trash and restoration", (t) => {
  const f = fixture(t),
    store = f.store;
  const before = Date.now();
  insert(store, 42);
  const first = store.ticketAddedAt(42);
  assert.ok(
    first && Date.parse(first) >= before && Date.parse(first) <= Date.now(),
  );
  insert(store, 42);
  assert.equal(store.ticketAddedAt(42), first);
  assert.equal(
    listLocalTickets(store, { ids: [42], fields: ["added_at"] }).tickets[0].added_at,
    first,
  );
  store.removeLocalTicket(42);
  assert.equal(store.ticketTrash()[0].added_at, first);
  store.restoreLocalTicket(42);
  assert.equal(store.ticketAddedAt(42), first);
  insert(store, 42, "another-source");
  assert.ok(store.ticketAddedAt(42, "another-source"));
  assert.equal(f.reopen().ticketAddedAt(42), first);
});
test("pre-migration ticket dates remain unknown, including restored legacy trash", (t) => {
  const f = fixture(t);
  // Simulate a database from before timestamp tracking existed.
  f.store.db.exec(
    "DROP TRIGGER ticket_first_added; DROP TABLE ticket_tracking_dates;",
  );
  insert(f.store, 1);
  const legacy = {
    source: f.store.source(),
    id: 2,
    title: "Legacy",
    state: "Active",
    assigned: "",
    type: "Bug",
    url: "",
    changed_at: "old",
    synced_at: "old",
  };
  f.store.db
    .prepare("INSERT INTO ticket_trash VALUES (?,?,?,?)")
    .run(legacy.source, 2, JSON.stringify(legacy), Date.now());
  const store = f.reopen();
  assert.equal(store.ticketAddedAt(1), null);
  insert(store, 1);
  assert.equal(store.ticketAddedAt(1), null);
  store.restoreLocalTicket(2);
  assert.equal(store.ticketAddedAt(2), null);
  insert(store, 3);
  assert.ok(store.ticketAddedAt(3));
});
test("expired trash also removes its local addition timestamp", (t) => {
  const { store } = fixture(t);
  insert(store, 42);
  store.removeLocalTicket(42);
  store.purgeTicketTrash(Date.now() + 31 * 86400000);
  assert.equal(store.ticketAddedAt(42), null);
});

test("Azure creation date survives local deletion and restoration independently of import date", (t) => {
  const f = fixture(t),
    store = f.store;
  insert(store, 42);
  const added = store.ticketAddedAt(42);
  store.saveTicketCreatedAt(42, store.source(), "2020-01-02T03:04:05Z");
  store.saveTicketCreatedAt(42, store.source(), undefined);
  assert.equal(store.ticketCreatedAt(42), "2020-01-02T03:04:05.000Z");
  assert.equal(store.ticketAddedAt(42), added);
  store.removeLocalTicket(42);
  assert.equal(store.ticketTrash()[0].created_at, "2020-01-02T03:04:05.000Z");
  store.restoreLocalTicket(42);
  assert.equal(f.reopen().ticketCreatedAt(42), "2020-01-02T03:04:05.000Z");
  assert.equal(f.store.ticketCreatedAt(42, "another-source"), null);
  f.store.removeLocalTicket(42);
  f.store.purgeTicketTrash(Date.now() + 31 * 86400000);
  assert.equal(f.store.ticketCreatedAt(42), null);
});
