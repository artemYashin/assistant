import test from "node:test";
import assert from "node:assert/strict";
import { ticketsCsv } from "../src/tickets-csv.js";
test("CSV preserves selected order and escapes quotes, delimiters, lines and formulas", () => {
  const csv = ticketsCsv([
    {
      id: 42,
      title: 'Ошибка; "текст"\nследующая строка',
      type: "Bug",
      state: "Active",
      priority: 2,
      tags: ["UI", "API"],
    },
    { id: 7, title: '=HYPERLINK("url")', state: "Ready for Development" },
  ]);
  assert.ok(csv.startsWith('\uFEFF"ID";'));
  assert.ok(
    csv.includes(
      '"42";"Ошибка; ""текст""\nследующая строка";"Bug";"Active";"2";"UI; API"\r\n',
    ),
  );
  assert.ok(
    csv.includes(
      '"7";"\'=HYPERLINK(""url"")";"";"Ready for Development";"1";""\r\n',
    ),
  );
  assert.ok(csv.indexOf('"42"') < csv.indexOf('"7"'));
});
