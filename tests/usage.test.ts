import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { UsageLedger } from "../server/usage.js";
import { Agent } from "../server/agent.js";
import { Approvals } from "../server/approvals.js";
const context = { client: "Customer", project: "Project" };
function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-usage-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return store;
}
test("usage deduplicates receipts, separates cache and preserves missing values", (t) => {
  const store = fixture(t),
    ledger = new UsageLedger(store),
    id = ledger.begin("model", context);
  const data = {
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 60,
    accounting: { sourceSessionId: "s", sequence: 1, usageId: "u" },
  };
  ledger.record(id, "a", data);
  ledger.record(id, "duplicate", data);
  ledger.record(id, "b", { inputTokens: 50, outputTokens: -1 });
  ledger.finish(id, "completed");
  ledger.begin("other", context);
  const report = ledger.report() as any;
  assert.equal(ledger.tokens(id), 170);
  assert.equal(report.summary.model_calls, 2);
  assert.equal(report.summary.cache_read_tokens, 60);
  assert.equal(report.summary.unreported_requests, 1);
  assert.equal(report.summary.possibly_partial_requests, 1);
  store.db
    .prepare("UPDATE llm_requests SET created_at=? WHERE id=?")
    .run("2020-01-01T00:00:00.000Z", id);
  assert.equal((ledger.report(1) as any).summary.requests, 1);
});
test("usage survives restart and marks unfinished requests interrupted", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-restart-"));
  const first = new Store(dir);
  const ledger = new UsageLedger(first);
  const id = ledger.begin("model", context);
  ledger.record(id, "e", { inputTokens: 42, outputTokens: 3 });
  first.close();
  const second = new Store(dir);
  t.after(() => {
    second.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const report = new UsageLedger(second).report() as any;
  assert.equal(report.requests[0].status, "interrupted");
  assert.equal(report.summary.input_tokens, 42);
});
function fakeAgent(
  store: Store,
  run: (session: any, config: any) => Promise<any>,
) {
  let handler: any,
    config: any,
    aborts = 0,
    stops = 0;
  const session = {
    on: (_name: string, fn: any) => {
      handler = fn;
    },
    emit: (data: any) => handler({ id: "receipt", data }),
    abort: async () => {
      aborts++;
    },
    sendAndWait: async () => run(session, config),
  };
  const client = {
    start: async () => {},
    createSession: async (c: any) => {
      config = c;
      return session;
    },
    stop: async () => {
      stops++;
    },
    forceStop: async () => {
      stops++;
    },
  };
  const agent = new Agent(
    store,
    new Approvals(store, async () => ({ id: "unused" })),
    () => client as any,
  );
  return { agent, counts: () => ({ aborts, stops }) };
}
test("one request records multiple model calls and completes cleanly", async (t) => {
  const store = fixture(t);
  const { agent, counts } = fakeAgent(store, async (s) => {
    s.emit({ inputTokens: 10, outputTokens: 2, apiCallId: "1" });
    s.emit({ inputTokens: 15, outputTokens: 4, apiCallId: "2" });
    return { data: { content: "Done" } };
  });
  assert.equal((await agent.chat("hello", context)).body, "Done");
  const report = new UsageLedger(store).report() as any;
  assert.equal(report.summary.model_calls, 2);
  assert.equal(report.requests[0].status, "completed");
  assert.equal(counts().stops, 1);
  assert.equal(agent.active(), null);
});
test("token threshold aborts multi-step work and saves usage", async (t) => {
  const store = fixture(t);
  store.set("settings", { llmMaxTokens: 1000 });
  const { agent, counts } = fakeAgent(store, async (s) => {
    s.emit({ inputTokens: 1000, outputTokens: 20 });
    return new Promise(() => {});
  });
  await assert.rejects(agent.chat("hello", context), /порог токенов/);
  assert.ok(counts().aborts);
  const report = new UsageLedger(store).report() as any;
  assert.equal(report.requests[0].status, "limited");
  assert.equal(report.summary.input_tokens, 1000);
});
test("tool limit denies the next tool and aborts the model loop", async (t) => {
  const store = fixture(t);
  store.set("settings", { llmMaxToolCalls: 1 });
  const { agent } = fakeAgent(store, async (_s, c) => {
    assert.equal(
      (await c.hooks.onPreToolUse({ toolName: "list_tickets" }))
        .permissionDecision,
      "allow",
    );
    assert.equal(
      (await c.hooks.onPreToolUse({ toolName: "list_tickets" }))
        .permissionDecision,
      "deny",
    );
    return new Promise(() => {});
  });
  await assert.rejects(agent.chat("hello", context), /лимит вызовов/);
  const report = new UsageLedger(store).report() as any;
  assert.equal(report.requests[0].tool_calls, 1);
  assert.equal(report.requests[0].status, "limited");
});
test("user stop cancels active work and concurrent requests are rejected", async (t) => {
  const store = fixture(t);
  let ready!: () => void;
  const started = new Promise<void>((r) => {
    ready = r;
  });
  const { agent, counts } = fakeAgent(store, async () => {
    ready();
    return new Promise(() => {});
  });
  const pending = agent.chat("hello", context);
  await started;
  await assert.rejects(agent.chat("second", context), /предыдущий запрос/);
  assert.equal(agent.stop().stopping, true);
  await assert.rejects(pending, /Остановлено пользователем/);
  assert.ok(counts().aborts);
  assert.equal(
    (new UsageLedger(store).report() as any).requests[0].status,
    "stopped",
  );
});
test("watchdog stops a model that never returns usage or a response", async (t) => {
  const store = fixture(t);
  store.set("settings", { llmTimeoutSeconds: 0.02 });
  const { agent, counts } = fakeAgent(store, async () => new Promise(() => {}));
  await assert.rejects(agent.chat("hello", context), /лимит времени/);
  assert.ok(counts().aborts);
  assert.equal(
    (new UsageLedger(store).report() as any).requests[0].status,
    "limited",
  );
});
