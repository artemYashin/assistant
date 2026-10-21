import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { memoryMarkdownFiles, type ExportMemory } from "../src/memory-export.js";
const context = { client: "Customer", project: "Project" };
const rows: ExportMemory[] = [
  { scope: "general", body: "**Fact**\n\n```ts\nfn();\n```", client: "", project: "" },
  { scope: "client", body: "Customer fact", client: "Customer", project: "" },
  { scope: "project", body: "Project fact", ...context },
  { scope: "project", body: "Other secret", client: "Other", project: "Project" },
];
test("Markdown export preserves bodies, selection and context boundaries", () => {
  const files = memoryMarkdownFiles(rows, ["general", "client", "project"], false, context);
  assert.equal(files.length, 1);
  assert.ok(files[0].text.includes(rows[0].body));
  assert.match(files[0].text, /Customer: Customer/);
  assert.match(files[0].text, /Project: Project/);
  assert.doesNotMatch(files[0].text, /Other secret/);
  const separate = memoryMarkdownFiles(rows, ["general", "project"], true, context, false);
  assert.deepEqual(separate.map(file => file.name), ["orbit-memory-general.md", "orbit-memory-project.md"]);
  assert.doesNotMatch(separate[1].text, /Project:|Customer:/);
  assert.deepEqual(memoryMarkdownFiles(rows, [], false, context), []);
  assert.deepEqual(memoryMarkdownFiles([], ["general"], true, context), []);
});
test("export includes more than the page limit but excludes other customers and proposals", t => {
  const dir = mkdtempSync(join(tmpdir(), "memory-export-"));
  const store = new Store(dir);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  for (let i = 0; i < 205; i++) store.addMemory("project", `Fact ${i}`, context);
  store.addMemory("project", "Other secret", { client: "Other", project: "Project" });
  assert.equal(store.memories(context).length, 200);
  const exported = store.memories(context, true) as ExportMemory[];
  assert.equal(exported.length, 205);
  assert.ok(exported.every(row => row.client === context.client));
});
