import test from "node:test";
import assert from "node:assert/strict";
import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { ticketBatchTool } from "../server/ticket-batch.js";
import { AppError } from "../server/store.js";

test("batch returns per-ticket results and never retries failed status writes", async (t) => {
  t.mock.method(console, "error", () => {});
  const calls: number[] = [];
  let running = false;
  const status = defineTool("change_ticket_status", {
    description: "test",
    parameters: z.object({ id: z.number(), state: z.string() }),
    handler: async ({ id, state }) => {
      assert.equal(running, false);
      running = true;
      calls.push(id);
      await Promise.resolve();
      running = false;
      if (id === 2) throw new AppError(403, "Недостаточно прав в Azure");
      return { success: true, state };
    },
  });
  const tool = ticketBatchTool([status]);
  const result: any = await tool.handler!(
    {
      operations: [1, 2, 3].map((id) => ({
        action: "status",
        id,
        state: "RFT",
      })),
    },
    {} as any,
  );
  assert.deepEqual(calls, [1, 2, 3]);
  assert.equal(result.success, false);
  assert.equal(result.succeeded, 2);
  assert.equal(result.failed, 1);
  assert.equal(result.results[0].state, "RFT");
  assert.match(result.results[1].error, /Недостаточно прав/);
  assert.ok(result.results[1].reference);
});

test("batch respects limits and stops before remaining operations", async (t) => {
  t.mock.method(console, "error", () => {});
  let count = 0;
  const tool = ticketBatchTool(
    [
      defineTool("remove_local_ticket", {
        description: "test",
        parameters: z.object({ id: z.number() }),
        handler: async () => {
          count++;
          return { success: true, azureChanged: false };
        },
      }),
    ],
    () => {
      if (count) throw new AppError(409, "Остановлено пользователем");
    },
  );
  const result: any = await tool.handler!(
    { operations: [1, 2, 3].map((id) => ({ action: "remove", id })) },
    {} as any,
  );
  assert.equal(count, 1);
  assert.equal(result.stopped, true);
  assert.equal(result.results[1].skipped, true);
  assert.equal(result.results[2].skipped, true);
  await assert.rejects(async () =>
    tool.handler!(
      {
        operations: Array.from({ length: 51 }, () => ({
          action: "remove",
          id: 1,
        })),
      },
      {} as any,
    ),
  );
  assert.equal(count, 1);
});

test("batch permits 50 local operations and 25 Azure changes; rejects oversized mixed batches before writes", async () => {
  let writes = 0;
  const tools = ["remove_local_ticket", "change_ticket_status"].map((name) =>
    defineTool(name, {
      description: "test",
      parameters: z.object({ id: z.number() }),
      handler: async () => {
        writes++;
        return { success: true };
      },
    }),
  );
  const tool = ticketBatchTool(tools);
  const local = (n: number) =>
    Array.from({ length: n }, (_, index) => ({
      action: "remove" as const,
      id: index + 1,
    }));
  const azure = (n: number) =>
    Array.from({ length: n }, (_, index) => ({
      action: "status" as const,
      id: index + 1,
      state: "Resolved",
    }));
  for (const operations of [
    local(50),
    azure(25),
    [...local(25), ...azure(25)],
  ]) {
    const result: any = await tool.handler!({ operations }, {} as any);
    assert.equal(result.success, true);
    assert.equal(result.succeeded, operations.length);
  }
  const before = writes;
  for (const operations of [
    local(51),
    azure(26),
    [...local(24), ...azure(26)],
  ]) {
    await assert.rejects(async () => tool.handler!({ operations }, {} as any));
    assert.equal(writes, before);
  }
});

test("chat batch sends consecutive status operations together and preserves results after cancellation", async () => {
  let envelopes = 0;
  const tool = ticketBatchTool(
    [],
    () => {
      if (envelopes) throw new AppError(409, "Stopped");
    },
    async (changes) => {
      envelopes++;
      assert.deepEqual(
        changes.map((x) => x.id),
        [1, 2],
      );
      return [
        { success: true, state: "RFT" },
        { success: false, error: "Revision conflict" },
      ];
    },
  );
  const result: any = await tool.handler!(
    {
      operations: [1, 2].map((id) => ({ action: "status", id, state: "RFT" })),
    },
    {} as any,
  );
  assert.equal(envelopes, 1);
  assert.equal(result.succeeded, 1);
  assert.equal(result.failed, 1);
  assert.match(result.results[1].error, /Revision conflict/);
});

test("shared metadata batch sends one patch, deduplicates IDs and returns partial outcomes", async () => {
  const calls: any[] = [];
  const tool = ticketBatchTool([defineTool("update_local_ticket_metadata", {
    description: "test",
    parameters: z.object({ id: z.number() }),
    handler: async (args, invocation) => {
      calls.push(args);
      assert.equal((invocation as any).orbitBatchChild, true);
      return args.id === 43 ? { success: false, error: "Missing ticket" } : { success: true, changedFields: ["tags"], azureChanged: false };
    },
  })]);
  const result: any = await tool.handler!({ ids: [42, 43, 42], metadata: { tags: { mode: "add", values: ["Inside 2"] } } }, {} as any);
  assert.deepEqual(calls, [42, 43].map(id => ({ id, tags: { mode: "add", values: ["Inside 2"] } })));
  assert.equal(result.total, 2);
  assert.equal(result.succeeded, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.results[1].error, "Missing ticket");
  const invalid: any[] = [
    { ids: [42] }, { metadata: { priority: 1 } },
    { ids: [], metadata: { priority: 1 } },
    { ids: Array.from({length: 51}, (_, i) => i + 1), metadata: { priority: 1 } },
    { ids: [42], metadata: {} },
    { ids: [42], metadata: { id: 43, priority: 1 } },
    { ids: [42], metadata: { priority: 1 }, operations: [{ action: "remove", id: 42 }] },
  ];
  for (const args of invalid) await assert.rejects(async () => tool.handler!(args, {} as any));
  assert.equal(calls.length, 2);
});

test("batch imports explicit IDs and reports partial failures without ticket bodies", async () => {
  const calls: number[] = [];
  const add = defineTool("add_local_ticket", {
    description: "import", parameters: z.object({ id: z.number() }),
    handler: async ({ id }) => {
      calls.push(id);
      return id === 43 ? { success: false, error: "Ticket belongs to another project" } : { success: true, id, azureChanged: false, body: "Must not enter batch output" };
    },
  });
  const batch = ticketBatchTool([add]);
  const result: any = await batch.handler!({ operations: [42, 43, 44].map(id => ({ action: "add", id })) }, {} as any);
  assert.deepEqual(calls, [42, 43, 44]);
  assert.equal(result.succeeded, 2);
  assert.equal(result.failed, 1);
  assert.equal(result.results[1].success, false);
  assert.equal(result.results[2].success, true);
  assert.equal(JSON.stringify(result).includes("Must not enter"), false);
});
