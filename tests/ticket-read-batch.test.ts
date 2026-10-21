import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { readCachedTicketBatch, readTicketLinksBatch } from "../server/ticket-read-batch.js";

test("batch cache reads include trash, missing IDs and lossless budget continuation", t => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-batch-"));
  const store = new Store(dir);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  for (let id = 1; id <= 8; id++) {
    store.db.prepare("INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?,?)").run(store.source(), id, `Ticket ${id}`, "Active", "", "Bug", "", "", "now");
    const body = "[Design](https://figma.com/file/test) " + "x".repeat(4000);
    store.db.prepare("INSERT INTO ticket_content_cache VALUES (?,?,?,?,?,?)").run(store.source(), id, "description", body, body.toLowerCase(), "now");
  }
  store.removeLocalTicket(2);
  const links = readTicketLinksBatch(store, { tickets: [{ id: 1 }, { id: 2 }, { id: 999 }] });
  assert.equal(links.results[0].links[0].url, "https://figma.com/file/test");
  assert.equal(links.results[1].deleted, true);
  assert.equal(links.results[2].available, false);
  let pending = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, offset: 0 }));
  const seen: number[] = [];
  while (pending.length) {
    const page = readCachedTicketBatch(store, { tickets: pending });
    assert.ok(JSON.stringify(page).length < 20000);
    assert.ok(page.results.length > 0);
    for (const result of page.results) {
      seen.push(result.id);
      assert.equal(result.nextOffset, 3000);
      const rest = readCachedTicketBatch(store, { tickets: [{ id: result.id, offset: result.nextOffset }] });
      assert.equal(rest.results[0].nextOffset, null);
    }
    pending = page.pending;
  }
  assert.deepEqual(seen, [1,2,3,4,5,6,7,8]);
  assert.throws(() => readCachedTicketBatch(store, { tickets: [{ id: 1 }, { id: 1 }] }));
});
