import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTicketDeadline } from "../services/backend/src/ticket-deadlines.js";
import { Store } from "../services/backend/src/store.js";
import { listLocalTickets } from "../services/backend/src/ticket-list.js";
import { searchTicketContent } from "../services/backend/src/ticket-content-search.js";
import { ticketSortSchema } from "../services/backend/src/ticket-sort.js";

test("every summary sort supports stable pagination for lists and content search", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-sort-")),
    store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const source = store.source();
  for (const id of [1, 2, 3]) {
    const value = id === 1 ? "Z" : "A";
    store.saveAzurePriority(id, source, id === 1 ? 3 : 1);
    const date = id === 1 ? "2026-10-22" : "2026-10-21";
    store.db
      .prepare("INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?,?)")
      .run(source, id, value, value, value, value, "url", date, date);
    store.db
      .prepare("INSERT INTO ticket_metadata VALUES (?,?,?,?,?)")
      .run(source, id, `${value} needle`, id === 1 ? 5 : 1, JSON.stringify([value]));
    setTicketDeadline(store, id, source, date + "T12:00:00.000Z");
    store.db
      .prepare("INSERT INTO ticket_azure_tags VALUES (?,?,?)")
      .run(source, id, JSON.stringify([value]));
    store.db
      .prepare("UPDATE ticket_tracking_dates SET created_at=?,added_at=? WHERE source=? AND id=?")
      .run(date, date, source, id);
    store.db.prepare("INSERT INTO local_developers VALUES (?,?, '','',1)").run(`dev${id}`, value);
    store.db.prepare("INSERT INTO ticket_developers VALUES (?,?,?)").run(source, id, `dev${id}`);
    store.db
      .prepare("INSERT INTO ticket_content_cache VALUES (?,?,?,?,?,?)")
      .run(source, id, "description", "needle", "needle", date);
  }
  for (const sortBy of ticketSortSchema.sortBy.removeDefault().options) {
    for (const sortDirection of ["asc", "desc"] as const) {
      const expected = ["id", "localUrl"].includes(sortBy)
        ? sortDirection === "asc"
          ? [1, 2, 3]
          : [3, 2, 1]
        : sortDirection === "asc"
          ? [2, 3, 1]
          : [1, 2, 3];
      for (const read of [listLocalTickets, searchTicketContent]) {
        let afterId = 0;
        const ids: number[] = [];
        for (let page = 0; page < 3; page++) {
          const result = read(store, {
            sortBy,
            sortDirection,
            limit: 1,
            afterId,
            ...(read === searchTicketContent ? { search: "needle" } : {}),
          });
          ids.push(...result.tickets.map((row: any) => row.id));
          afterId = result.nextAfterId ?? 0;
          assert.equal(result.hasMore, page < 2);
        }
        assert.deepEqual(ids, expected, `${sortBy} ${sortDirection}`);
      }
    }
  }
});

test("sorted content search includes Unicode notes without cache and keeps missing dates last", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-sort-notes-")),
    store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const source = store.source();
  for (const [id, changed] of [
    [1, null],
    [2, "2026-10-22"],
    [3, "2026-10-21"],
  ] as const) {
    store.db
      .prepare("INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?,?)")
      .run(source, id, `Ticket ${id}`, "Active", "Dev", "Bug", "url", changed, "now");
    store.db
      .prepare("INSERT INTO ticket_metadata VALUES (?,?,?,?,?)")
      .run(source, id, "ЗАМЕТКА", 1, "[]");
  }
  for (const sortDirection of ["asc", "desc"] as const) {
    const result = searchTicketContent(store, {
      search: "заметка",
      sortBy: "changed_at",
      sortDirection,
    });
    assert.deepEqual(
      result.tickets.map((t) => t.id),
      sortDirection === "asc" ? [3, 2, 1] : [2, 3, 1],
    );
    assert.ok(result.tickets.every((t) => t.section === "notes"));
    assert.equal(result.coverage.cached, 0);
  }
});
