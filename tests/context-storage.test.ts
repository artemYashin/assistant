import test from "node:test";
import assert from "node:assert/strict";
import { copyRenamedContextStorage } from "../src/context-storage.js";

test("renaming carries customer presets and legacy filters including collapsed state", () => {
  const values: Record<string, string> = {
    'orbit.ticket-presets.customer.active:"Customer"': '[{"name":"Bugs"}]',
    'orbit.ticket-presets.customer.active:"Customer".selected': 'preset-id',
    'orbit.ticket-filters.customer.trash:"Customer"': '{"query":"test"}',
    'orbit.ticket-filters.active:["source","Customer","Portal"].expanded': 'false',
    'orbit.ticket-filters.azure:["source","Other","Portal"]': 'unrelated',
  };
  const storage = new Proxy(values, { get(target, key) {
    if (key === "getItem") return (k: string) => target[k] ?? null;
    if (key === "setItem") return (k: string, v: string) => { target[k] = v; };
    return target[String(key)];
  } }) as unknown as Storage;
  copyRenamedContextStorage(storage, { client: "Customer", project: "" }, "New");
  copyRenamedContextStorage(storage, { client: "New", project: "Portal" }, "Site");
  assert.equal(values['orbit.ticket-presets.customer.active:"New"'], '[{"name":"Bugs"}]');
  assert.equal(values['orbit.ticket-presets.customer.active:"New".selected'], 'preset-id');
  assert.equal(values['orbit.ticket-filters.customer.trash:"New"'], '{"query":"test"}');
  assert.equal(values['orbit.ticket-filters.active:["source","New","Site"].expanded'], 'false');
  assert.equal(values['orbit.ticket-filters.azure:["source","Other","Portal"]'], 'unrelated');
});
