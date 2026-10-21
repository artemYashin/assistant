import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Store } from "../server/store.js";
import { MemoryProposals, memoryProposalTool } from "../server/memory-proposals.js";
import { MemoryMarkdown } from "../src/MemoryMarkdown.js";

test("pending memory edits are approved verbatim, processed proposals cannot change", t => {
  const dir = mkdtempSync(join(tmpdir(), "memory-edit-"));
  const store = new Store(dir);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  assert.equal(store.settings().memoryLanguage, "English");
  store.set("settings", { ...store.settings(), memoryLanguage: "Russian" });
  assert.match(memoryProposalTool(store, { client: "C", project: "P" }, () => {}).description!, /Russian/);
  const service = new MemoryProposals(store);
  const { id } = service.propose({ scope: "project", body: "Original", reason: "Useful" }, { client: "C", project: "P" });
  assert.ok(id);
  assert.throws(() => service.edit(id!, { body: " " }));
  service.edit(id!, { body: "**Edited**\n\n`function`" });
  assert.equal((store.db.prepare("SELECT count(*) AS n FROM memories").get() as any).n, 0);
  service.decide(id!, true);
  assert.equal((store.db.prepare("SELECT body FROM memories").get() as any).body, "**Edited**\n\n`function`");
  assert.throws(() => service.edit(id!, { body: "Too late" }), /обработано/);
  assert.throws(() => service.edit("missing", { body: "New" }), /не найдено/);
});
test("memory renders formatting and code without executing HTML", () => {
  const html = renderToStaticMarkup(createElement(MemoryMarkdown, { body: "**Fact**\n\n- item\n\n```ts\nfn();\n```\n\n<script>alert(1)</script>" }));
  assert.match(html, /<strong>Fact<\/strong>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<pre><code/);
  assert.doesNotMatch(html, /<script/);
});

test("AI refinement edits the same draft with scope and stale-body protection", async t => {
  const { memoryRefinementTools } = await import("../server/memory-proposals.js");
  const dir = mkdtempSync(join(tmpdir(), "memory-refine-"));
  const store = new Store(dir);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const context = { client: "C", project: "P" };
  const service = new MemoryProposals(store);
  const { id } = service.propose({ scope: "project", body: "Long draft", reason: "Useful" }, context);
  let changes = 0;
  const tools = memoryRefinementTools(store, context, () => {}, () => { changes++; });
  const edit = (body: string, expectedBody: string) => tools.find(tool => tool.name === "edit_memory_proposal")!.handler!({ id, body, expectedBody } as any, {} as any) as Promise<any>;
  await edit("Short draft", "Long draft");
  assert.equal(service.forContext(id!, context).body, "Short draft");
  assert.equal(service.list().length, 1);
  assert.equal((store.db.prepare("SELECT count(*) AS n FROM memories").get() as any).n, 0);
  assert.equal(changes, 1);
  await assert.rejects(edit("Stale replacement", "Long draft"), /изменилось/);
  assert.throws(() => service.forContext(id!, { client: "C", project: "Other" }), /недоступно/);
  service.decide(id!, true);
  await assert.rejects(edit("Too late", "Short draft"), /обработано/);
});
