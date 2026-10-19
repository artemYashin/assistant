import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-trash-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const source = store.source();
  store.db
    .prepare(
      "INSERT INTO tickets VALUES (?,42,'Bug title','Active','Azure Owner','Bug','https://ado.test/42','2026-01-01','2026-01-02')",
    )
    .run(source);
  store.db
    .prepare(
      "INSERT INTO ticket_local(source,id,developer_id,developer_name) VALUES (?,42,'dev','Local Dev')",
    )
    .run(source);
  store.db
    .prepare(
      "INSERT INTO local_developers(id,name,client,project,active) VALUES ('dev','Local Dev','','',1)",
    )
    .run();
  store.db
    .prepare("INSERT INTO ticket_developers VALUES (?,42,'dev')")
    .run(source);
  return { store, source };
}
test("trash preserves snapshot and assignments, restores locally, and repeated removal does not extend retention", (t) => {
  const { store, source } = fixture(t);
  store.removeLocalTicket(42);
  const [snapshot] = store.ticketTrash();
  assert.equal(snapshot.assigned, "Azure Owner");
  assert.equal(snapshot.developers[0].name, "Local Dev");
  assert.equal(
    store.db.prepare("SELECT count(*) n FROM tickets").get() &&
      (store.db.prepare("SELECT count(*) n FROM tickets").get() as any).n,
    0,
  );
  store.removeLocalTicket(42);
  assert.equal(store.ticketTrash()[0].removedAt, snapshot.removedAt);
  assert.throws(() => store.restoreLocalTicket(42, "other-source"));
  store.restoreLocalTicket(42, source);
  assert.equal(store.ticketTrash().length, 0);
  assert.equal(
    (store.db.prepare("SELECT title FROM tickets WHERE id=42").get() as any)
      .title,
    "Bug title",
  );
  assert.equal(
    (store.db.prepare("SELECT count(*) n FROM ticket_developers").get() as any)
      .n,
    1,
  );
  assert.equal(
    (
      store.db
        .prepare("SELECT removed FROM ticket_local WHERE id=42")
        .get() as any
    ).removed,
    0,
  );
});
test("trash expires at 30 days and retains only the auto-import exclusion marker", (t) => {
  const { store } = fixture(t);
  store.removeLocalTicket(42);
  const removed = store.ticketTrash()[0].removedAt;
  assert.equal(store.purgeTicketTrash(removed + 30 * 86400000 - 1), 0);
  assert.equal(store.purgeTicketTrash(removed + 30 * 86400000), 1);
  assert.equal(store.ticketTrash().length, 0);
  assert.equal(
    (store.db.prepare("SELECT count(*) n FROM ticket_developers").get() as any)
      .n,
    0,
  );
  const local = store.db
    .prepare("SELECT * FROM ticket_local WHERE id=42")
    .get() as any;
  assert.equal(local.removed, 1);
  assert.equal(local.developer_name, "");
  assert.throws(() => store.restoreLocalTicket(42));
});
