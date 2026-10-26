import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, defaults } from "../services/backend/src/store.js";

for (const custom of [false, true]) {
  test(`memory prompt migration ${custom ? "preserves custom instructions" : "updates the old default"}`, (t) => {
    const dir = mkdtempSync(join(tmpdir(), "orbit-memory-prompt-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const before = new Store(dir);
    const instructions = custom
      ? "Мой собственный промпт"
      : "Отвечай по-русски, кратко и по делу. Помогай видеть обязательства, сроки и упущенные тикеты. Сохраняй факты в память, когда я явно прошу.";
    before.set("settings", { instructions, client: "Customer" });
    before.db.prepare("DELETE FROM kv WHERE key=?").run("migration.proactiveMemoryInstructions");
    before.close();
    const after = new Store(dir);
    try {
      assert.equal(after.settings().instructions, custom ? instructions : defaults.instructions);
      assert.equal(after.settings().client, "Customer");
      assert.match(
        defaults.instructions,
        /propose useful durable facts, agreements and preferences for approval/,
      );
    } finally {
      after.close();
    }
  });
}

test("memory writing guidance is lazy, shared by writing tools and leaves saved data untouched", async (t) => {
  const { makeTools, SYSTEM_POLICY } = await import("../services/backend/src/agent.js");
  const { memoryProposalTool, memoryRefinementTools } =
    await import("../services/backend/src/memory-proposals.js");
  const { createToolDiscovery } = await import("../services/backend/src/tool-discovery.js");
  const dir = mkdtempSync(join(tmpdir(), "orbit-lazy-memory-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const context = { client: "Customer", project: "Project" };
  store.set("settings", {
    ...store.settings(),
    memoryLanguage: "Russian",
    instructions: "Keep my preferences",
  });
  const { id: memoryId } = store.addMemory(
    "project",
    "Existing useful body",
    context,
    "Existing summary",
  );
  const before = store.memoryDetail(memoryId, context);
  const tools = [
    ...makeTools(store, context),
    memoryProposalTool(store, context, () => {}),
    ...memoryRefinementTools(
      store,
      context,
      () => {},
      () => {},
    ),
  ].filter((tool) => /memory|memories/.test(tool.name));
  let published: typeof tools = [];
  const discovery = createToolDiscovery(
    tools,
    async (entries) => {
      published = entries;
    },
    () => {},
  );
  assert.match(SYSTEM_POLICY, /read_memory/);
  assert.match(SYSTEM_POLICY, /proposals for approval on the Approvals page/);
  assert.doesNotMatch(SYSTEM_POLICY, /max 320 characters|Preferred memory language/);
  assert.doesNotMatch(
    discovery.description!,
    /Preferred memory language|max 320 characters|immutable before-values/,
  );
  for (const name of ["save_memory", "propose_memory", "edit_memory_proposal"]) {
    await discovery.handler!({ names: [name] }, {} as any);
    const loaded = published.find((tool) => tool.name === name)!;
    assert.match(loaded.description!, /Russian/);
    assert.match(loaded.description!, /max 320 characters/);
    assert.match(loaded.description!, /verified excerpts from illustrative examples/);
    assert.match(loaded.description!, /Never approve or directly save memory/);
  }
  assert.match(
    published.find((tool) => tool.name === "edit_memory_proposal")!.description!,
    /exact previous summary and body/,
  );
  assert.deepEqual(store.memoryDetail(memoryId, context), before);
  assert.equal(store.settings().instructions, "Keep my preferences");
  assert.equal((store.db.prepare("SELECT COUNT(*) n FROM memory_proposals").get() as any).n, 0);
});
