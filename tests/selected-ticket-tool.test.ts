import test from "node:test";
import assert from "node:assert/strict";
import { selectedTicketTool } from "../server/selected-ticket-tool.js";

test("selection reads are paginated, deduplicated and scoped to the requested selection", async () => {
  const ids = Array.from({ length: 250 }, (_, i) => i + 1);
  const read: number[] = [];
  const tool = selectedTicketTool([777, 777, 888], { state: "minimized", ids, total: 250, columns: ["title", "id"], format: "csv" }, () => {}, id => read.push(id));
  const result: any = await tool.handler!({ target: "export", offset: 200 }, {} as any);
  assert.deepEqual(result.ids, ids.slice(200));
  assert.equal(result.total, 250);
  assert.equal(result.nextOffset, null);
  assert.deepEqual(result.columns, ["title", "id"]);
  assert.deepEqual(read, ids.slice(200));
  const first: any = await tool.handler!({ target: "export", offset: 0 }, {} as any);
  assert.equal(first.ids.length, 100);
  assert.equal(first.nextOffset, 100);
  const table: any = await tool.handler!({ target: "table", offset: 0 }, {} as any);
  assert.deepEqual(table.ids, [777, 888]);
  assert.equal(table.columns, undefined);
});

test("closed export exposes no stale selection and cancellation prevents reads", async () => {
  for (const draft of [undefined, { state: "closed" as const, ids: [123], total: 1, columns: ["id" as const], format: "xlsx" as const }]) {
    const tool = selectedTicketTool([], draft, () => {});
    const result: any = await tool.handler!({ target: "export", offset: 0 }, {} as any);
    assert.deepEqual(result.ids, []);
    assert.equal(result.state, "closed");
    assert.equal(result.columns, undefined);
  }
  const tool = selectedTicketTool([123], undefined, () => { throw new Error("cancelled"); });
  await assert.rejects(() => tool.handler!({ target: "table", offset: 0 }, {} as any) as Promise<any>, /cancelled/);
});
