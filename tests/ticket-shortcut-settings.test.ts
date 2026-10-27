import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../services/backend/src/store.js";

test("ticket shortcut defaults, legacy conflicts and custom settings", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-ticket-shortcut-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
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

test("create shortcut preserves populated settings and existing Y bindings across restarts", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-create-shortcut-"));
  let store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  assert.equal(store.settings().ticketCreateKey, "KeyY");
  assert.equal(store.settings().ticketCreatePress, "single");
  for (const key of [
    "chatToggleKey",
    "voiceInputKey",
    "voiceCurrentKey",
    "voiceNewKey",
    "ticketOpenKey",
  ]) {
    store.set("settings", { [key]: "KeyY", instructions: "Keep existing instructions" });
    assert.equal(store.settings().ticketCreateKey, "");
    assert.equal((store.settings() as any)[key], "KeyY");
    assert.equal(store.settings().instructions, "Keep existing instructions");
  }
  store.set("settings", { ticketCreateKey: "Ctrl+KeyY", ticketCreatePress: "double" });
  store.close();
  store = new Store(dir);
  assert.equal(store.settings().ticketCreateKey, "Ctrl+KeyY");
  assert.equal(store.settings().ticketCreatePress, "double");
  store.set("settings", { ticketCreateKey: "" });
  assert.equal(store.settings().ticketCreateKey, "");
});
