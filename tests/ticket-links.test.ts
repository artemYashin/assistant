import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { readTicketLinks } from "../server/ticket-links.js";
import { searchTicketContent } from "../server/ticket-content-search.js";

test("cached link lookup returns URLs without bodies and content search can target one ticket", t => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-links-")), store = new Store(dir);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const body = "Long unrelated requirement. [Design **one**](https://figma.com/design/a)\n\n![Screen](https://img.test/screen.png)\n\n[Design two][design]\n\n[design]: https://figma.com/design/b";
  for (const id of [1, 2]) {
    store.db.prepare("INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?,?)").run(store.source(), id, `Ticket ${id}`, "Active", "", "Bug", "", "", "now");
    store.db.prepare("INSERT INTO ticket_content_cache VALUES (?,?,?,?,?,?)").run(store.source(), id, "description", body, body.toLocaleLowerCase(), "now");
  }
  const page = readTicketLinks(store, { id: 1, search: "figma", limit: 1 });
  assert.equal(page.total, 2);
  assert.deepEqual(page.links?.[0], { section: "description", kind: "link", label: "Design one", url: "https://figma.com/design/a" });
  assert.equal(page.nextOffset, 1);
  assert.equal(readTicketLinks(store, { id: 1, search: "figma", offset: 1 }).links?.[0].url, "https://figma.com/design/b");
  assert.equal(JSON.stringify(page).includes("Long unrelated requirement"), false);
  assert.equal(readTicketLinks(store, { id: 1, kind: "image" }).total, 1);
  assert.equal(readTicketLinks(store, { id: 999 }).available, false);
  assert.deepEqual(searchTicketContent(store, { id: 2, search: "requirement" }).tickets.map(t => t.id), [2]);
  assert.equal(searchTicketContent(store, { id: 999, search: "requirement" }).tickets.length, 0);
});
