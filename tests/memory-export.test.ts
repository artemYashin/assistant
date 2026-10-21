import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { posix } from "node:path";
import JSZip from "jszip";
import { Store } from "../server/store.js";
import { memoryMarkdownFiles, type ExportMemory } from "../src/memory-export.js";
const context = { client: "Customer", project: "Project" };
const rows: ExportMemory[] = [
  { scope: "general", body: "**Fact**\n\n```ts\nfn();\n```", client: "", project: "" },
  { scope: "client", body: "Customer fact", client: "Customer", project: "" },
  { scope: "project", body: "Project fact", ...context },
  { scope: "project", body: "Other secret", client: "Other", project: "Project" },
];
test("split export keeps details out of indexes and all relative links resolve in the ZIP", async () => {
  const entries = rows.map((row, i) => ({ ...row, id: `id-${i}`, summary: `Название [${i}]` }));
  for (const separate of [false, true]) {
    const files = memoryMarkdownFiles(entries, ["general", "project"], separate, context, false, true);
    assert.equal(files.length, separate ? 4 : 3);
    const zip = new JSZip();
    for (const file of files) zip.file(file.name, file.text);
    const restored = await JSZip.loadAsync(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
    for (const file of files) {
      assert.equal(await restored.file(file.name)!.async("string"), file.text);
      assert.doesNotMatch(file.text, /Other secret|Customer fact/);
      if (!file.name.startsWith("details/")) {
        assert.doesNotMatch(file.text, /fn\(\)|Project fact|Memory ID:/);
        assert.ok(file.text.includes("Название \\["));
      }
      for (const match of file.text.matchAll(/\]\(([^)]+\.md)\)/g)) {
        const target = posix.normalize(posix.join(posix.dirname(file.name), match[1]));
        assert.ok(restored.file(target), `Missing link target: ${target}`);
      }
    }
    assert.ok(files.find(file => file.name === "details/general-001.md")!.text.includes(rows[0].body));
    assert.deepEqual(memoryMarkdownFiles(entries, [], separate, context, true, true), []);
  }
});
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

test("review memory exports as a separate scope without leaking other projects", () => {
  const memories: ExportMemory[] = [
    { scope: "project_review", summary: "Review rules", body: "Check errors", ...context },
    { scope: "project_review", summary: "Other", body: "Secret", client: context.client, project: "Other" },
  ];
  const files = memoryMarkdownFiles(memories, ["project_review"], true, context, true, true);
  assert.deepEqual(files.map(file => file.name), ["orbit-memory-project_review.md", "details/project_review-001.md"]);
  assert.ok(files[1].text.includes("Check errors"));
  assert.ok(files.every(file => !file.text.includes("Secret")));
});
