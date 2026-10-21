import test from "node:test";
import assert from "node:assert/strict";
import { customerPresetKey, migrateCustomerPresets } from "../src/ticket-preset-storage.js";

function storage() {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    key: (i: number) => [...values.keys()][i] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
  };
}
const key = (customer: string, project: string, source = "source") =>
  `orbit.ticket-filters.active:${JSON.stringify([source, customer, project])}`;

test("presets share customer scope across projects and Azure connections", () => {
  assert.equal(customerPresetKey(key("A", "P")), customerPresetKey(key("A", "Q", "other")));
  assert.notEqual(customerPresetKey(key("A", "P")), customerPresetKey(key("B", "P")));
});
test("migration merges old presets, preserves originals and does not resurrect deletions", () => {
  const data = storage();
  const first = key("A", "P") + ".presets";
  data.setItem(first, JSON.stringify([{ id: "id", name: "Bugs", filters: { query: "bug" } }]));
  data.setItem(key("A", "Q") + ".presets", JSON.stringify([{ id: "id", name: "Bugs", filters: { query: "other" } }]));
  data.setItem(key("B", "P") + ".presets", JSON.stringify([{ id: "foreign", name: "Other customer", filters: {} }]));
  const target = migrateCustomerPresets(data, key("A", "P"));
  const result = JSON.parse(data.getItem(target)!);
  assert.equal(result.length, 2);
  assert.notEqual(result[0].id, result[1].id);
  assert.notEqual(result[0].name, result[1].name);
  assert.ok(data.getItem(first));
  data.setItem(target, "[]");
  migrateCustomerPresets(data, key("A", "Q"));
  assert.equal(data.getItem(target), "[]");
});
