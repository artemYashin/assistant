import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";

test("ticket shortcut defaults, legacy conflicts and custom settings", t => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-ticket-shortcut-"));
  const store = new Store(dir);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  assert.equal(store.settings().ticketOpenKey, "KeyT");
  assert.equal(store.settings().ticketOpenPress, "single");
  for (const key of ["chatToggleKey", "voiceInputKey", "voiceCurrentKey", "voiceNewKey"]) {
    store.set("settings", { [key]: "KeyT" });
    assert.equal(store.settings().ticketOpenKey, "");
    assert.equal((store.settings() as any)[key], "KeyT");
  }
  store.set("settings", { ticketOpenKey: "Ctrl+KeyT", ticketOpenPress: "double" });
  assert.equal(store.settings().ticketOpenKey, "Ctrl+KeyT");
  assert.equal(store.settings().ticketOpenPress, "double");
  store.set("settings", { ticketOpenKey: "" });
  assert.equal(store.settings().ticketOpenKey, "");
});
