import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";

test("chat token default applies to missing values and preserves saved limits on restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-chat-default-"));
  let store = new Store(dir);
  try {
    assert.equal(store.settings().llmMaxTokens, 250000);
    store.addContext({ client: "Example", project: "Existing" });
    for (const value of [undefined, 100000, 42000]) {
      store.set("settings", { instructions: "Preserved instructions", ...(value === undefined ? {} : { llmMaxTokens: value }) });
      for (let i = 0; i < 2; i++) {
        store.close();
        store = new Store(dir);
        assert.equal(store.settings().llmMaxTokens, value ?? 250000);
        assert.equal(store.settings().instructions, "Preserved instructions");
        assert.equal(store.settings().reviewMaxTokens, 1000000);
        assert.ok(store.contexts().some(c => c.client === "Example" && c.project === "Existing"));
      }
    }
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
