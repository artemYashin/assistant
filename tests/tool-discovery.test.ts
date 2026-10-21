import test from "node:test";
import assert from "node:assert/strict";
import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { createToolDiscovery } from "../server/tool-discovery.js";
import { SYSTEM_POLICY } from "../server/chat-policy.js";

test("discovery publishes requested schemas without executing handlers and retains previous tools", async () => {
  let executed = 0;
  const publications: string[][] = [];
  const tools = ["list_tickets", "get_ticket"].map((name) =>
    defineTool(name, {
      description:
        "Detailed instructions that should not be in the initial catalog",
      parameters: z.object({ id: z.number() }),
      handler: async () => {
        executed++;
        return {};
      },
    }),
  );
  const discovery = createToolDiscovery(
    tools,
    async (entries) => {
      publications.push(entries.map((t) => t.name));
    },
    () => {},
  );
  assert.doesNotMatch(discovery.description!, /Detailed instructions/);
  await discovery.handler!({ names: ["list_tickets"] }, {} as any);
  assert.deepEqual(publications[0], ["load_tools", "list_tickets"]);
  await discovery.handler!({ names: ["get_ticket"] }, {} as any);
  assert.deepEqual(publications[1], [
    "load_tools",
    "list_tickets",
    "get_ticket",
  ]);
  await discovery.handler!({ names: ["get_ticket"] }, {} as any);
  assert.equal(publications.length, 2);
  assert.equal(executed, 0);
  await assert.rejects(async () =>
    discovery.handler!({ names: ["shell"] }, {} as any),
  );
  assert.equal(publications.length, 2);
});

test("failed publication is retryable and concurrent discovery does not lose tools", async () => {
  let fail = true;
  let published: string[] = [];
  const tools = ["list_tickets", "get_ticket"].map((name) =>
    defineTool(name, {
      description: name,
      parameters: z.object({}),
      handler: async () => ({}),
    }),
  );
  const discovery = createToolDiscovery(
    tools,
    async (entries) => {
      if (fail) throw new Error("RPC unavailable");
      published = entries.map((t) => t.name);
    },
    () => {},
  );
  await assert.rejects(async () =>
    discovery.handler!({ names: ["list_tickets"] }, {} as any),
  );
  fail = false;
  await Promise.all([
    discovery.handler!({ names: ["list_tickets"] }, {} as any),
    discovery.handler!({ names: ["get_ticket"] }, {} as any),
  ]);
  assert.deepEqual(published, ["load_tools", "list_tickets", "get_ticket"]);
});

test("compact English policy preserves language and approval requirements", () => {
  assert.match(SYSTEM_POLICY, /language of the user's current message/);
  assert.match(SYSTEM_POLICY, /verification GET/);
  assert.match(SYSTEM_POLICY, /separate human approval in the UI/);
  assert.match(SYSTEM_POLICY, /separate consent/);
  assert.ok(SYSTEM_POLICY.length < 7000);
});

test("a greeting starts with discovery only and does not publish tool schemas", async (t) => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { Store } = await import("../server/store.js");
  const { Agent } = await import("../server/agent.js");
  const { Approvals } = await import("../server/approvals.js");
  const dir = mkdtempSync(join(tmpdir(), "orbit-discovery-"));
  const store = new Store(dir);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  let published = 0;
  const client = {
    start: async () => {}, stop: async () => {},
    createSession: async (config: any) => {
      assert.deepEqual(config.tools.map((tool: any) => tool.name), ["load_tools"]);
      return {
        on: () => {}, abort: async () => {},
        setTools: async () => { published++; },
        sendAndWait: async () => ({ data: { content: "Привет!" } }),
      };
    },
  };
  const agent = new Agent(store, new Approvals(store, async () => ({ id: "unused" })), () => client as any);
  assert.equal((await agent.chat("Привет", { client: "", project: "" })).body, "Привет!");
  assert.equal(published, 0);
});
