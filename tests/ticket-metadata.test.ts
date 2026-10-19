import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import {
  ticketMetadata,
  saveTicketMetadata,
  priorityCount,
} from "../server/ticket-metadata.js";
import { listLocalTickets } from "../server/ticket-list.js";
function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-metadata-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  store.db
    .prepare(
      "INSERT INTO tickets VALUES (?,42,'Bug','Active','','Bug','','','')",
    )
    .run(store.source());
  return store;
}
const context = { client: "Client", project: "Project" };
test("local metadata is independent, validates priorities, merges fields, and filters chat lists", (t) => {
  const store = fixture(t);
  assert.equal(ticketMetadata(store, 42).priority, 2);
  assert.equal(priorityCount(store, context), 3);
  store.set('ticket-priorities:["Client",""]', 5);
  assert.equal(priorityCount(store, context), 5);
  store.set('ticket-priorities:["Client","Project"]', 4);
  assert.equal(priorityCount(store, context), 4);
  saveTicketMetadata(store, 42, store.source(), context, {
    notes: "Ready for retest",
    tags: ["UI", "UI", "Bug"],
    priority: 4,
  });
  saveTicketMetadata(store, 42, store.source(), context, {
    notes: "Not ready",
  });
  assert.deepEqual(ticketMetadata(store, 42), {
    notes: "Not ready",
    tags: ["UI", "Bug"],
    priority: 4,
  });
  assert.throws(() =>
    saveTicketMetadata(store, 42, store.source(), context, { priority: 5 }),
  );
  assert.throws(() =>
    saveTicketMetadata(store, 42, "other", context, { notes: "No" }),
  );
  assert.throws(() =>
    saveTicketMetadata(store, 99, store.source(), context, { notes: "No" }),
  );
  assert.equal(listLocalTickets(store, { priority: 4, tag: "ui" }).total, 1);
  assert.equal(listLocalTickets(store, { priority: 2 }).total, 0);
  assert.equal(
    listLocalTickets(store, { tag: "UI" }).tickets[0].notes,
    "Not ready",
  );
  store.db.prepare("UPDATE tickets SET state='Resolved' WHERE id=42").run();
  assert.equal(ticketMetadata(store, 42).priority, 4);
  assert.equal(ticketMetadata(store, 42, "other").priority, 2);
});
test("trash retains metadata until expiry and restores it", (t) => {
  const store = fixture(t);
  saveTicketMetadata(store, 42, store.source(), context, {
    notes: "Remember",
    priority: 1,
    tags: ["urgent"],
  });
  store.removeLocalTicket(42);
  assert.equal(store.ticketTrash()[0].notes, "Remember");
  store.restoreLocalTicket(42);
  assert.equal(ticketMetadata(store, 42).priority, 1);
  store.removeLocalTicket(42);
  store.purgeTicketTrash(Date.now() + 31 * 86400000);
  assert.deepEqual(ticketMetadata(store, 42), {
    notes: "",
    priority: 2,
    tags: [],
  });
});
