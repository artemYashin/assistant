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
    sendAndWait: async (request: any) => {
      (session as any).prompt = request.prompt;
      return run(session, config);
    },
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

test("manual PR review has no tools or chat history and still accounts usage", async (t) => {
  const store = fixture(t);
  store.say("user", "private chat history", context);
  store.addMemory("general", "General knowledge", context);
  store.addMemory("client", "Client knowledge", context);
  store.addMemory("project", "Project knowledge", context);
  store.addMemory("project", "Other project secret", {
    ...context,
    project: "Other",
  });
  const { agent } = fakeAgent(store, async (s, c) => {
    assert.match(s.prompt, /General knowledge/);
    assert.match(s.prompt, /Client knowledge/);
    assert.match(s.prompt, /Project knowledge/);
    assert.doesNotMatch(s.prompt, /Other project secret|private chat history/);
    assert.deepEqual(c.tools, []);
    assert.deepEqual(c.excludedTools, ["builtin:*", "mcp:*"]);
    assert.equal(
      (await c.hooks.onPreToolUse({ toolName: "propose_teams_message" }))
        .permissionDecision,
      "deny",
    );
    s.emit({ inputTokens: 500, outputTokens: 100 });
    return { data: { content: "Review" } };
  });
  await agent.chat("Review this diff", context, true);
  assert.equal(store.history(context).length, 1);
  assert.equal(
    (new UsageLedger(store).report() as any).summary.input_tokens,
    500,
  );
});

test("chat fetches a mentioned ticket live and persists its UI card reference", async (t) => {
  const store = fixture(t);
  let fetched = 0,
    prompt = "";
  const session = {
    on: () => {},
    sendAndWait: async (request: any) => {
      prompt = request.prompt;
      return { data: { content: "Ticket details" } };
    },
    abort: async () => {},
  };
  const client = {
    start: async () => {},
    createSession: async () => session,
    stop: async () => {},
    forceStop: async () => {},
  };
  const connectors = {
    ticketDetails: async (id: number) => {
      fetched++;
      assert.equal(id, 123456);
      return {
        cardId: "card-reference",
        fields: { "System.Title": "Current Azure title" },
        comments: [{ text: "Latest comment" }],
      };
    },
  };
  const agent = new Agent(
    store,
    new Approvals(store, async () => ({ id: "unused" })),
    () => client as any,
    connectors as any,
  );
  const result = await agent.chat("Покажи тикет 123456", context);
  assert.equal(fetched, 1);
  assert.deepEqual(result.cards, ["card-reference"]);
  assert.match(prompt, /Current Azure title/);
  assert.match(prompt, /Latest comment/);
  assert.equal(
    (store.history(context).at(-1) as any).cards,
    '["card-reference"]',
  );
});

test("status tool requires current user instruction and deduplicates repeated writes", async (t) => {
  const store = fixture(t);
  let config: any,
    writes = 0,
    allow = true;
  const session = {
    on: () => {},
    abort: async () => {},
    sendAndWait: async () => {
      const tool = config.tools.find(
        (x: any) => x.name === "change_ticket_status",
      );
      if (allow) {
        const first = await tool.handler({ id: 123456, state: "RFT" }, {});
        const again = await tool.handler(
          { id: 123456, state: "Ready for Testing" },
          {},
        );
        assert.equal(first.state, again.state);
      } else
        await assert.rejects(
          tool.handler({ id: 123456, state: "RFT" }, {}),
          /явная команда/,
        );
      return { data: { content: "Result" } };
    },
  };
  const client = {
    start: async () => {},
    createSession: async (c: any) => {
      config = c;
      return session;
    },
    stop: async () => {},
    forceStop: async () => {},
  };
  const connectors = {
    ticketDetails: async () => ({ cardId: "card", fields: {} }),
    changeTicketStatus: async () => {
      writes++;
      return { success: true, state: "RFT", outcome: "changed" };
    },
  };
  const agent = new Agent(
    store,
    new Approvals(store, async () => ({ id: "unused" })),
    () => client as any,
    connectors as any,
  );
  await agent.chat("Переведи тикет 123456 в RFT", context);
  assert.equal(writes, 1);
  allow = false;
  await agent.chat("Покажи тикет 123456. Статус RFT?", context);
  assert.equal(writes, 1);
});

test("review feedback tools are limited to questions and memory proposals with ordinary usage guard", async (t) => {
  const store = fixture(t);
  let questions: any[] = [];
  const { agent } = fakeAgent(store, async (_s, c) => {
    assert.deepEqual(c.tools.map((tool: any) => tool.name).sort(), [
      "ask_review_questions",
      "propose_memory",
    ]);
    assert.equal(
      (await c.hooks.onPreToolUse({ toolName: "save_memory" }))
        .permissionDecision,
      "deny",
    );
    assert.equal(
      (await c.hooks.onPreToolUse({ toolName: "ask_review_questions" }))
        .permissionDecision,
      "allow",
    );
    await c.tools
      .find((tool: any) => tool.name === "ask_review_questions")
      .handler(
        { questions: [{ question: "Contract?", reason: "Unknown input" }] },
        {},
      );
    await c.tools
      .find((tool: any) => tool.name === "propose_memory")
      .handler(
        { scope: "project", body: "A durable fact", reason: "Useful later" },
        {},
      );
    return { data: { content: "Needs clarification" } };
  });
  await agent.chat("Review", context, true, {
    askQuestions: (batch) => {
      questions = batch;
    },
  });
  assert.equal(questions.length, 1);
  assert.equal(store.memories(context).length, 0);
  assert.equal(
    (store.db.prepare("SELECT count(*) n FROM memory_proposals").get() as any)
      .n,
    1,
  );
});
