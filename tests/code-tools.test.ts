import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { codeTools } from "../server/code-tools.js";
import { makeTools } from "../server/agent.js";
import { Approvals } from "../server/approvals.js";
import { MemoryProposals } from "../server/memory-proposals.js";

function setup(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-code-tools-"));
  const store = new Store(dir);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  return store;
}
test("code tools are scoped, local-only, paginated and disabled at invocation time", async t => {
  const store = setup(t), calls: any[] = [];
  const fake = { request: async (input: any) => {
    calls.push(input);
    if (input.operation === "file") return { sha: "a".repeat(40), text: Array.from({ length: 300 }, (_, i) => `line ${i + 1}`).join("\n") };
    return { sha: "a".repeat(40), results: Array.from({ length: 20 }, (_, i) => ({ path: `src/${i}.ts`, line: i + 1 })), total: 20, more: false };
  } };
  const tools = codeTools(store, { client: "Client", project: "Project" }, () => {}, fake as any);
  const invoke = (name: string, input: any) => tools.find(tool => tool.name === name)!.handler!(input, {} as any) as Promise<any>;
  const result = await invoke("code_read_file", { branch: "main", path: "a.ts", startLine: 3, endLine: 5 });
  assert.deepEqual(result.lines.map((line: any) => line.line), [3,4,5]);
  assert.equal(result.nextLine, null);
  const search = await invoke("code_search", { branch: "main", query: "line", mode: "content", offset: 0, limit: 2 });
  assert.equal(search.results.length, 2); assert.equal(search.nextOffset, 2);
  assert.equal(calls[1].revision, "a".repeat(40));
  assert.ok(calls.every(call => call.localOnly && !call.refresh && call.client === "Client" && call.project === "Project"));
  store.set("settings", { ...store.settings(), assistantCodeAccess: false });
  assert.deepEqual(codeTools(store, { client: "Client", project: "Project" }, () => {}), []);
  await assert.rejects(invoke("code_read_file", { branch: "main", path: "a.ts", startLine: 1 }), /отключён/);
});
test("save_memory only creates a proposal until UI approval", async t => {
  const store = setup(t);
  const tools = makeTools(store, new Approvals(store, async () => ({ id: "unused" })), { client: "", project: "" });
  const save = tools.find(tool => tool.name === "save_memory") as import("@github/copilot-sdk").Tool<any>;
  const result: any = await save.handler!({ scope: "general", body: "Verified short fact" }, {} as any);
  assert.equal(result.status, "pending");
  assert.equal((store.db.prepare("SELECT count(*) AS n FROM memories").get() as any).n, 0);
  new MemoryProposals(store).decide(result.id, true);
  assert.equal((store.db.prepare("SELECT count(*) AS n FROM memories").get() as any).n, 1);
});
