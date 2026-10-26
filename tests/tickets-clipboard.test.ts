import test from "node:test";
import assert from "node:assert/strict";
import { ticketsClipboard } from "../services/frontend/src/features/export-tickets/index.js";

test("rich clipboard preserves export columns, order and zero values", () => {
  const result = ticketsClipboard(
    [
      { id: 42, title: "First", azurePriority: 0 },
      { id: 7, title: "Second" },
    ],
    ["title", "id", "azurePriority"],
  );
  assert.equal(result.text, "Title\tID\tAzure Priority\nFirst\t42\t0\nSecond\t7\t");
  assert.match(result.html, /<thead><tr><th/);
  assert.ok(result.html.indexOf("First") < result.html.indexOf("Second"));
  assert.match(result.html, />0<\/td>/);
  assert.deepEqual(ticketsClipboard([], ["id"]), { html: "", text: "" });
  assert.deepEqual(ticketsClipboard([{ id: 1 }], []), { html: "", text: "" });
});
test("ticket content is escaped, not interpreted as HTML", () => {
  const result = ticketsClipboard(
    [{ id: 1, title: '<img src=x onerror="bad()"> &\nnext\tcell' }],
    ["title"],
  );
  assert.ok(!result.html.includes("<img"));
  assert.ok(result.html.includes("&lt;img src=x onerror=&quot;bad()&quot;&gt; &amp;<br>"));
  assert.equal(result.text, 'Title\n<img src=x onerror="bad()"> & next cell');
});
