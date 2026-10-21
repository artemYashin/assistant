import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { openChatRuntime, chatRuntimeKey } from "../server/chat-runtime.js";

test("chat runtime resumes the same transcript with current tools, without compaction or cross-chat search", async t => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-runtime-")), store = new Store(dir);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const context = { client: "A", project: "B" }, chat = store.createChat(context);
  let creates = 0;
  const options: any[] = [], resumed: string[] = [];
  const client: any = {
    createSession: async (config: any) => { options.push(config); return { sessionId: `sdk-${++creates}` }; },
    resumeSession: async (id: string, config: any) => { resumed.push(id); options.push(config); return { sessionId: id }; },
  };
  const config: any = { tools: [{ name: "load_tools" }], availableTools: ["custom:load_tools"], onPermissionRequest: () => ({ kind: "reject" }) };
  const first = await openChatRuntime(client, config, store, chat.id, "source");
  assert.equal(first.resumed, false);
  const next = await openChatRuntime(client, { ...config, model: "new-model" }, store, chat.id, "source");
  assert.equal(next.resumed, true);
  assert.equal(creates, 1);
  assert.deepEqual(resumed, [first.session.sessionId]);
  assert.equal(options[1].model, "new-model");
  assert.equal(options[1].tools, config.tools);
  assert.equal(options[1].continuePendingWork, false);
  assert.equal(options[1].infiniteSessions.enabled, false);
  assert.equal(options[1].enableSessionStore, false);
  const other = store.createChat(context);
  assert.equal((await openChatRuntime(client, config, store, other.id, "source")).resumed, false);
  assert.equal((await openChatRuntime(client, config, store, chat.id, "other-source")).resumed, false);
  store.clearHistory(context, chat.id);
  assert.equal(store.get(chatRuntimeKey(chat.id), null), null);
  assert.equal((await openChatRuntime(client, config, store, chat.id, "other-source")).resumed, false);
  store.detachChatTicket(context, chat.id);
  assert.equal(store.get(chatRuntimeKey(chat.id), null), null);
});

test("missing or unavailable SDK transcripts never silently discard context", async t => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-runtime-errors-")), store = new Store(dir);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.set(chatRuntimeKey("chat"), { sessionId: "old", source: "source", lastSequence: 42 });
  let error = "Network unavailable", creates = 0;
  const client: any = {
    resumeSession: async () => { throw new Error(error); },
    createSession: async () => { creates++; return { sessionId: "new" }; },
  };
  await assert.rejects(openChatRuntime(client, {} as any, store, "chat", "source"), /Network/);
  assert.equal(creates, 0);
  error = "Session old not found";
  await assert.rejects(openChatRuntime(client, {} as any, store, "chat", "source"), /Не найдена сохранённая/);
  assert.equal(creates, 0);
});

test("agent continuation avoids replaying prior messages and keeps new app-only messages", async t => {
  const { Agent } = await import("../server/agent.js");
  const { Approvals } = await import("../server/approvals.js");
  const dir = mkdtempSync(join(tmpdir(), "orbit-agent-runtime-")), store = new Store(dir);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const context = { client: "A", project: "B" }, chat = store.createChat(context);
  const prompts: string[] = [];
  let creates = 0, resumes = 0;
  const session = { sessionId: "durable-sdk", on: () => () => {}, abort: async () => {}, setTools: async () => {}, sendAndWait: async ({ prompt }: any) => { prompts.push(prompt); return { data: { content: "First response" } }; } };
  const client: any = { start: async () => {}, stop: async () => {}, forceStop: async () => {},
    createSession: async () => { creates++; return session; },
    resumeSession: async (id: string) => { assert.equal(id, session.sessionId); resumes++; return session; } };
  store.say("user", "Legacy context", context, [], chat.id);
  const agent = new Agent(store, new Approvals(store, async () => ({ id: "unused" })), () => client);
  await agent.chat("Hello", context, false, undefined, chat.id);
  store.say("assistant", "App-only notice", context, [], chat.id);
  await agent.chat("Continue", context, false, undefined, chat.id);
  assert.equal(creates, 1);
  assert.equal(resumes, 1);
  assert.match(prompts[0], /Legacy context/);
  assert.doesNotMatch(prompts[1], /Legacy context|First response|Hello/);
  assert.match(prompts[1], /App-only notice/);
  assert.match(prompts[1], /Continue/);
  store.clearHistory(context, chat.id);
  await agent.chat("Fresh", context, false, undefined, chat.id);
  assert.equal(creates, 2);
  assert.doesNotMatch(prompts[2], /Legacy context|First response|App-only notice/);
});

test("context occupancy is separate from cumulative usage, scoped and cleared with the chat", async t => {
  const { UsageLedger } = await import("../server/usage.js");
  const dir = mkdtempSync(join(tmpdir(), "orbit-context-")), store = new Store(dir);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const context = { client: "A", project: "B" }, chat = store.createChat(context), other = store.createChat(context);
  const ledger = new UsageLedger(store);
  ledger.recordContext(chat.id, context, { currentTokens: 42000, tokenLimit: 128000 }, "model");
  assert.equal(ledger.sessionUsage(context, chat.id).contextUsage.currentTokens, 42000);
  assert.equal(ledger.sessionUsage(context, chat.id).inputTokens, 0);
  assert.equal(ledger.sessionUsage(context, other.id).contextUsage, null);
  ledger.recordContext(chat.id, context, { currentTokens: NaN, tokenLimit: 0 }, "model");
  assert.equal(ledger.sessionUsage(context, chat.id).contextUsage.tokenLimit, 128000);
  assert.throws(() => ledger.recordContext(chat.id, { client: "Other", project: "B" }, { currentTokens: 1, tokenLimit: 10 }, "model"));
  store.clearHistory(context, chat.id);
  assert.equal(ledger.sessionUsage(context, chat.id).contextUsage, null);
});

test("review resumes one SDK transcript with lazy memory and optional read-only code tools", async t => {
  const { Agent } = await import("../server/agent.js");
  const { Approvals } = await import("../server/approvals.js");
  const dir = mkdtempSync(join(tmpdir(), "orbit-review-runtime-")), store = new Store(dir);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const context = { client: "A", project: "B" };
  store.addMemory("project_review", "Full secret review details", context, "Review summary");
  store.addMemory("general", "Excluded memory", context, "Excluded summary");
  const memory = store.reviewMemory(context, ["project_review"])[0];
  const excluded = store.memoryCatalog(context)[0];
  const prompts: string[] = [];
  const configs: any[] = [];
  let creates = 0, resumes = 0;
  const session = { sessionId: "review-sdk", on: () => () => {}, abort: async () => {},
    sendAndWait: async ({ prompt }: any) => {
      prompts.push(prompt);
      const tools = configs.at(-1).tools;
      const read = tools.find((tool: any) => tool.name === "read_memory");
      assert.ok(read);
      assert.match(JSON.stringify(await read.handler({ id: memory.id }, {})), /Full secret review details/);
      assert.doesNotMatch(JSON.stringify(await read.handler({ id: excluded.id }, {})), /Excluded memory/);
      assert.equal(tools.some((tool: any) => tool.name === "change_ticket_status"), false);
      return { data: { content: "Review result" } };
    } };
  const client: any = { start: async () => {}, stop: async () => {}, forceStop: async () => {},
    createSession: async (config: any) => { creates++; configs.push(config); return session; },
    resumeSession: async (id: string, config: any) => { assert.equal(id, session.sessionId); resumes++; configs.push(config); return session; } };
  const agent = new Agent(store, new Approvals(store, async () => ({ id: "unused" })), () => client);
  const options = { reviewId: "review-one", memoryScopes: ["project_review"] as const, readCode: true, branch: "feature/test", continuationPrompt: "Answer to the question" };
  await agent.chat("Original multi-file diff", context, true, { ...options, memoryScopes: [...options.memoryScopes] });
  await agent.chat("Original multi-file diff again", context, true, { ...options, memoryScopes: [...options.memoryScopes] });
  assert.equal(creates, 1); assert.equal(resumes, 1);
  assert.match(prompts[0], /Review summary/);
  assert.doesNotMatch(prompts[0], /Full secret review details|Excluded summary/);
  assert.match(prompts[1], /Answer to the question/);
  assert.doesNotMatch(prompts[1], /Original multi-file diff/);
  assert.ok(configs[0].tools.some((tool: any) => tool.name === "code_search"));
  assert.equal(configs[0].infiniteSessions.enabled, false);
  await agent.chat("Different review", context, true, { ...options, reviewId: "review-two", memoryScopes: [...options.memoryScopes], readCode: false });
  assert.equal(creates, 2);
  assert.ok(configs[2].tools.every((tool: any) => !tool.name.startsWith("code_")));
});
