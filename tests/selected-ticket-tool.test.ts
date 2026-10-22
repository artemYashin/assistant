import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selectedTicketTool } from "../server/selected-ticket-tool.js";

test("selection reads are paginated, deduplicated and scoped to the requested selection", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "selection-")); const store = new Store(dir);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  for (const id of [...Array.from({length: 250}, (_, i) => i + 1), 777, 888])
    store.db.prepare("INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?,?)").run(store.source(), id, "Ticket " + id, "Active", "Person", "Bug", "", "", "now");
  const ids = Array.from({ length: 250 }, (_, i) => i + 1);
  const read: number[] = [];
  const tool = selectedTicketTool(store, [777, 777, 888], { state: "minimized", ids, total: 250, columns: ["title", "id"], format: "csv" }, () => {}, id => read.push(id));
  const result: any = await tool.handler!({ target: "export", offset: 200 }, {} as any);
  assert.deepEqual(result.tickets.map((t: any) => t.id), ids.slice(200));
  assert.equal(result.total, 250);
  assert.equal(result.nextOffset, null);
  assert.deepEqual(result.columns, ["title", "id"]);
  assert.deepEqual(read, ids.slice(200));
  const first: any = await tool.handler!({ target: "export", offset: 0 }, {} as any);
  assert.equal(first.tickets.length, 100);
  assert.equal(first.nextOffset, 100);
  const table: any = await tool.handler!({ target: "table", offset: 0 }, {} as any);
  assert.deepEqual(table.tickets.map((t: any) => t.id), [777, 888]);
  assert.equal(table.columns, undefined);
  assert.deepEqual(table.tickets[0], { id: 777, title: "Ticket 777", state: "Active", type: "Bug" });
  const extra: any = await tool.handler!({ target: "table", offset: 0, fields: ["assigned", "tags"] }, {} as any);
  assert.equal(extra.tickets[0].assigned, "Person");
  assert.deepEqual(extra.tickets[0].tags, []);
});

test("closed export exposes no stale selection and cancellation prevents reads", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "selection-")); const store = new Store(dir);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  for (const id of [...Array.from({length: 250}, (_, i) => i + 1), 777, 888])
    store.db.prepare("INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?,?)").run(store.source(), id, "Ticket " + id, "Active", "Person", "Bug", "", "", "now");
  for (const draft of [undefined, { state: "closed" as const, ids: [123], total: 1, columns: ["id" as const], format: "xlsx" as const }]) {
    const tool = selectedTicketTool(store, [], draft, () => {});
    const result: any = await tool.handler!({ target: "export", offset: 0 }, {} as any);
    assert.deepEqual(result.tickets, []);
    assert.equal(result.state, "closed");
    assert.equal(result.columns, undefined);
  }
  const tool = selectedTicketTool(store, [123], undefined, () => { throw new Error("cancelled"); });
  await assert.rejects(() => tool.handler!({ target: "table", offset: 0 }, {} as any) as Promise<any>, /cancelled/);
});
