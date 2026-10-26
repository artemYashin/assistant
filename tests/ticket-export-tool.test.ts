import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../services/backend/src/store.js";
import { ticketExportTool } from "../services/backend/src/ticket-export-tool.js";

test("export tool dispatches local IDs including trash, without duplicates or bodies", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-export-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  for (const id of [42, 43])
    store.db
      .prepare("INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?,?)")
      .run(store.source(), id, "Private title", "Active", "", "Bug", "", "", "now");
  store.removeLocalTicket(43);
  store.db
    .prepare("INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?,?)")
    .run("other-source", 44, "Other", "", "", "", "", "", "now");
  const events: any[] = [];
  const tool = ticketExportTool(
    store,
    () => {},
    (event) => events.push(event),
  );
  const result: any = await tool.handler!({ ids: [42, 43, 42, 44, 999] }, {} as any);
  assert.deepEqual(events, [{ stage: "ticket_export", ids: [42, 43], mode: "open" }]);
  assert.deepEqual(result.missing, [44, 999]);
  assert.equal(JSON.stringify(result).includes("Private title"), false);
  await tool.handler!({ ids: [] }, {} as any);
  assert.deepEqual(events[1], { stage: "ticket_export", ids: [], mode: "open" });
  await tool.handler!({ ids: [999] }, {} as any);
  assert.equal(events.length, 2);
  await assert.rejects(
    () => ticketExportTool(store, () => {}).handler!({ ids: [42] }, {} as any) as Promise<any>,
    /интерфейса/,
  );
  await assert.rejects(
    () =>
      ticketExportTool(
        store,
        () => {
          throw new Error("stopped");
        },
        () => {},
      ).handler!({ ids: [42] }, {} as any) as Promise<any>,
    /stopped/,
  );
  assert.equal(events.length, 2);
});

test("export columns are ordered, deduplicated and independent of ticket selection", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-export-columns-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const events: any[] = [];
  const tool = ticketExportTool(
    store,
    () => {},
    (event) => events.push(event),
  );
  const result: any = await tool.handler!(
    { ids: [], columns: ["state", "id", "title", "state"] },
    {} as any,
  );
  assert.deepEqual(result.columns, ["state", "id", "title"]);
  assert.deepEqual(events[0], {
    stage: "ticket_export",
    ids: [],
    mode: "open",
    columns: ["state", "id", "title"],
  });
  const { ticketExportContextSchema, exportColumnSchema } =
    await import("../services/backend/src/ticket-export-context.js");
  assert.equal(exportColumnSchema.safeParse("unknown-column").success, false);
  assert.equal(
    ticketExportContextSchema.safeParse({
      state: "minimized",
      ids: [42],
      total: 1,
      columns: ["title", "id"],
      format: "csv",
    }).success,
    true,
  );
});

test("edit export requires active draft and removes only requested IDs", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-export-edit-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const draft = {
    state: "minimized" as "minimized" | "closed",
    ids: [1, 2],
    total: 2,
    columns: ["id" as const],
    format: "csv" as const,
  };
  store.db
    .prepare("INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?,?)")
    .run(store.source(), 3, "Three", "Active", "", "Bug", "", "", "now");
  const events: any[] = [];
  const tool = ticketExportTool(
    store,
    () => {},
    (event) => events.push(event),
    draft,
    true,
  );
  assert.equal(tool.name, "edit_ticket_export");
  await tool.handler!({ addIds: [3], removeIds: [1] }, {} as any);
  assert.deepEqual(events[0], { stage: "ticket_export", mode: "edit", ids: [3], removeIds: [1] });
  assert.deepEqual(draft.ids, [2, 3]);
  assert.equal(draft.state, "minimized");
  await tool.handler!({ removeIds: [2, 3] }, {} as any);
  assert.deepEqual(draft.ids, []);
  assert.equal(draft.state, "minimized");
  draft.state = "closed";
  await assert.rejects(
    () => tool.handler!({ removeIds: [1] }, {} as any) as Promise<any>,
    /Экспорт закрыт/,
  );
  assert.equal(events.length, 2);
  assert.equal((store.db.prepare("SELECT count(*) AS n FROM tickets").get() as any).n, 1);
});
