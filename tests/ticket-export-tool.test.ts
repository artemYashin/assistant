import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { ticketExportTool } from "../server/ticket-export-tool.js";

test("export tool dispatches local IDs including trash, without duplicates or bodies", async t => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-export-")); const store = new Store(dir);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  for (const id of [42, 43]) store.db.prepare("INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?,?)").run(store.source(), id, "Private title", "Active", "", "Bug", "", "", "now");
  store.removeLocalTicket(43);
  store.db.prepare("INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?,?)").run("other-source", 44, "Other", "", "", "", "", "", "now");
  const events: any[] = []; const tool = ticketExportTool(store, () => {}, event => events.push(event));
  const result: any = await tool.handler!({ ids: [42, 43, 42, 44, 999], mode: "add" }, {} as any);
  assert.deepEqual(events, [{ stage: "ticket_export", ids: [42, 43], mode: "add" }]);
  assert.deepEqual(result.missing, [44, 999]); assert.equal(JSON.stringify(result).includes("Private title"), false);
  await tool.handler!({ ids: [], mode: "open" }, {} as any);
  assert.deepEqual(events[1], { stage: "ticket_export", ids: [], mode: "open" });
  await tool.handler!({ ids: [999], mode: "add" }, {} as any); assert.equal(events.length, 2);
  await assert.rejects(() => ticketExportTool(store, () => {}).handler!({ ids: [42], mode: "open" }, {} as any) as Promise<any>, /интерфейса/);
  await assert.rejects(() => ticketExportTool(store, () => { throw new Error("stopped"); }, () => {}).handler!({ ids: [42], mode: "open" }, {} as any) as Promise<any>, /stopped/);
  assert.equal(events.length, 2);
});

test("export columns are ordered, deduplicated and independent of ticket selection", async t => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-export-columns-")); const store = new Store(dir);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const events: any[] = [];
  const tool = ticketExportTool(store, () => {}, event => events.push(event));
  const result: any = await tool.handler!({ ids: [], mode: "add", columns: ["state", "id", "title", "state"] }, {} as any);
  assert.deepEqual(result.columns, ["state", "id", "title"]);
  assert.deepEqual(events[0], { stage: "ticket_export", ids: [], mode: "add", columns: ["state", "id", "title"] });
  const { ticketExportContextSchema, exportColumnSchema } = await import("../server/ticket-export-context.js");
  assert.equal(exportColumnSchema.safeParse("unknown-column").success, false);
  assert.equal(ticketExportContextSchema.safeParse({ state: "minimized", ids: [42], total: 1, columns: ["title", "id"], format: "csv" }).success, true);
});
