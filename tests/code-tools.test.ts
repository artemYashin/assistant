import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { codeTools, configuredCodeBranch } from "../server/code-tools.js";
import { makeTools } from "../server/agent.js";
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
  assert.equal(calls[0].localReadWaitMs, 20000);
  store.set("settings", { ...store.settings(), assistantCodeWaitSeconds: 35 });
  await invoke("code_read_file", { branch: "main", path: "a.ts", startLine: 1 });
  assert.equal(calls.at(-1).localReadWaitMs, 35000);
  assert.ok(calls.every(call => call.localOnly && !call.refresh && call.client === "Client" && call.project === "Project"));
  store.set("settings", { ...store.settings(), assistantCodeAccess: false });
  assert.deepEqual(codeTools(store, { client: "Client", project: "Project" }, () => {}), []);
  await assert.rejects(invoke("code_read_file", { branch: "main", path: "a.ts", startLine: 1 }), /отключён/);
});
test("save_memory only creates a proposal until UI approval", async t => {
  const store = setup(t);
  const tools = makeTools(store, { client: "", project: "" });
  const save = tools.find(tool => tool.name === "save_memory") as import("@github/copilot-sdk").Tool<any>;
  const result: any = await save.handler!({ scope: "general", body: "Verified short fact" }, {} as any);
  assert.equal(result.status, "pending");
  assert.equal((store.db.prepare("SELECT count(*) AS n FROM memories").get() as any).n, 0);
  new MemoryProposals(store).decide(result.id, true);
  assert.equal((store.db.prepare("SELECT count(*) AS n FROM memories").get() as any).n, 1);
});

test("code reads default to configured branch, allow explicit override and pin revisions per branch", async t => {
  const store = setup(t), calls: any[] = [];
  const fake = { request: async (input: any) => {
    calls.push(input);
    if (input.operation === "branches") return { defaultBranch: "main" };
    return { sha: input.branch === "dev" ? "d".repeat(40) : "a".repeat(40), text: "code" };
  } };
  const tools = codeTools(store, { client: "Client", project: "Project" }, () => {}, fake as any, "dev");
  const read = (args: any) => tools.find(tool => tool.name === "code_read_file")!.handler!({ path: "file.ts", startLine: 1, ...args }, {} as any) as Promise<any>;
  assert.equal((await read({})).branch, "dev");
  assert.equal((await read({ branch: "feature" })).branch, "feature");
  assert.equal(calls[1].revision, undefined);
  await read({});
  assert.equal(calls[2].revision, "d".repeat(40));
  const defaults = codeTools(store, { client: "Client", project: "Project" }, () => {}, fake as any);
  const result: any = await defaults.find(tool => tool.name === "code_read_file")!.handler!({ path: "file.ts", startLine: 1 } as any, {} as any);
  assert.equal(result.branch, "main");
  assert.ok(calls.every(call => call.localOnly && !call.refresh));
});

test("code citations validate ranges and preserve scoped branch/file links", async t => {
  const store = setup(t);
  const fake = { request: async () => ({ sha: "a".repeat(40), text: "first\nsecond\nthird" }) };
  const tools = codeTools(store, { client: "Client", project: "Project" }, () => {}, fake as any, "dev");
  const cite = (references: any[]) => tools.find(tool => tool.name === "cite_code")!.handler!({ references } as any, {} as any) as Promise<any>;
  const result = await cite([{ path: "src/some file.ts", startLine: 2, endLine: 3 }]);
  const params = new URL(result.references[0].localUrl, "https://orbit.local").searchParams;
  assert.equal(params.get("branch"), "dev");
  assert.equal(params.get("path"), "src/some file.ts");
  assert.equal(params.get("line"), "2");
  assert.equal(params.get("endLine"), "3");
  await assert.rejects(cite([{ path: "file.ts", startLine: 4 }]), /Диапазон/);
});

test("branch search filters before pagination and prioritizes exact matches", async t => {
  const store = setup(t);
  const tools = codeTools(store, { client: "C", project: "P" }, () => {}, { request: async () => ({ branches: ["feature/dev-ui", "main", "dev", "DEV-test"], defaultBranch: "main" }) } as any);
  const result: any = await tools.find(tool => tool.name === "code_branches")!.handler!({ search: "dev", offset: 0, limit: 2 } as any, {} as any);
  assert.deepEqual(result.branches, ["dev", "feature/dev-ui"]);
  assert.equal(result.total, 3);
  assert.equal(result.nextOffset, 2);
});

test("main branch is resolved from current project repository settings", t => {
  const store = setup(t);
  store.set("settings", { ...store.settings(), azureUrl: "https://dev.azure.com/org", azureProject: "AzureProject" });
  store.db.prepare("INSERT INTO pr_projects(id,client,project,source,azure_project,mode,enabled,main_branch) VALUES (?,?,?,?,?,?,?,?)").run("repo", "C", "P", "https://dev.azure.com/org", "AzureProject", "all", 1, "dev");
  assert.equal(configuredCodeBranch(store, { client: "C", project: "P" }), "dev");
  assert.equal(configuredCodeBranch(store, { client: "C", project: "Other" }), undefined);
});

test("code citations preserve explicitly requested branch instead of configured default", async t => {
  const store = setup(t), calls: any[] = [];
  const tools = codeTools(store, { client: "C", project: "P" }, () => {}, { request: async (input: any) => { calls.push(input); return { sha: "a".repeat(40), text: "one\ntwo" }; } } as any, "main");
  const result: any = await tools.find(tool => tool.name === "cite_code")!.handler!({ references: [{ branch: "feature/dev", path: "src/a.ts", startLine: 1, endLine: 2 }] } as any, {} as any);
  const params = new URL(result.references[0].localUrl, "https://orbit.local").searchParams;
  assert.equal(params.get("branch"), "feature/dev");
  assert.equal(calls[0].branch, "feature/dev");
  assert.equal(params.get("path"), "src/a.ts");
  assert.equal(params.get("endLine"), "2");
});

test("review code reads pin the PR monitor and commit from the very first request", async t => {
  const store = setup(t), calls: any[] = [];
  const revision = "c".repeat(40);
  const browser = { request: async (input: any) => { calls.push(input); return { sha: revision, text: "const value = 1;" }; } };
  const tools = codeTools(store, { client: "Client", project: "Project" }, () => {}, browser as any, "feature", () => true, { monitor: "pr-monitor", branch: "feature", revision });
  await tools.find(tool => tool.name === "code_read_file")!.handler!({ path: "a.ts", startLine: 1 } as any, {} as any);
  assert.equal(calls[0].monitor, "pr-monitor");
  assert.equal(calls[0].revision, revision);
  assert.equal(calls[0].branch, "feature");
  assert.equal(calls[0].localOnly, true);
});


test("review citation validates the pinned source and links the PR branch and line range", async t => {
  const store = setup(t), calls: any[] = [], revision = "d".repeat(40);
  const browser = { request: async (input: any) => { calls.push(input); return { sha: revision, text: "one\ntwo\nthree" }; } };
  const tools = codeTools(store, { client: "Client", project: "Project" }, () => {}, browser as any, "feature/review", () => true, { monitor: "monitor", branch: "feature/review", revision });
  const result: any = await tools.find(tool => tool.name === "cite_code")!.handler!({ references: [{ path: "src/example.ts", startLine: 2, endLine: 3 }] } as any, {} as any);
  assert.equal(calls[0].revision, revision);
  assert.equal(calls[0].monitor, "monitor");
  const params = new URL(result.references[0].localUrl, "https://orbit.local").searchParams;
  assert.equal(params.get("branch"), "feature/review");
  assert.equal(params.get("revision"), revision);
  assert.equal(params.get("path"), "src/example.ts");
  assert.equal(params.get("line"), "2");
  assert.equal(params.get("endLine"), "3");
});

test("review reads reject another branch and a mismatched backend SHA", async t => {
  const store = setup(t), revision = "c".repeat(40);
  const browser = { request: async () => ({ sha: "d".repeat(40), text: "wrong revision" }) };
  const tools = codeTools(store, { client: "Client", project: "Project" }, () => {}, browser as any, "feature", () => true, { monitor: "m", branch: "feature", revision });
  const cite = tools.find(tool => tool.name === "cite_code")!.handler!;
  await assert.rejects(() => cite({ references: [{ branch: "main", path: "a.ts" }] } as any, {} as any) as Promise<any>, /source-ветку/);
  await assert.rejects(() => cite({ references: [{ path: "a.ts" }] } as any, {} as any) as Promise<any>, /не соответствует/);
});
