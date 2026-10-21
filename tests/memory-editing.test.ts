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
