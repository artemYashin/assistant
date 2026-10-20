import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, defaults } from "../server/store.js";

for (const custom of [false, true]) {
  test(`memory prompt migration ${custom ? "preserves custom instructions" : "updates the old default"}`, (t) => {
    const dir = mkdtempSync(join(tmpdir(), "orbit-memory-prompt-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const before = new Store(dir);
    const instructions = custom
      ? "Мой собственный промпт"
      : "Отвечай по-русски, кратко и по делу. Помогай видеть обязательства, сроки и упущенные тикеты. Сохраняй факты в память, когда я явно прошу.";
    before.set("settings", { instructions, client: "Customer" });
    before.db
      .prepare("DELETE FROM kv WHERE key=?")
      .run("migration.proactiveMemoryInstructions");
    before.close();
    const after = new Store(dir);
    try {
      assert.equal(
        after.settings().instructions,
        custom ? instructions : defaults.instructions,
      );
      assert.equal(after.settings().client, "Customer");
      assert.match(defaults.instructions, /через подтверждения/);
    } finally {
      after.close();
    }
  });
}
