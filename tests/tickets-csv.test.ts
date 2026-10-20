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
      azureTags: ["Customer", "Backend"],
    },
    { id: 7, title: '=HYPERLINK("url")', state: "Ready for Development" },
  ]);
  assert.ok(csv.startsWith('\uFEFF"ID";'));
  assert.ok(
    csv.includes(
      '"42";"Ошибка; ""текст""\nследующая строка";"Bug";"Active";"2";"UI; API";"Customer; Backend"\r\n',
    ),
  );
  assert.ok(
    csv.includes(
      '"7";"\'=HYPERLINK(""url"")";"";"Ready for Development";"1";"";""\r\n',
    ),
  );
  assert.ok(csv.indexOf('"42"') < csv.indexOf('"7"'));
});

test("CSV exports only chosen columns with English headers and all local owners", () => {
  const csv = ticketsCsv(
    [
      {
        id: 5,
        title: "Hidden",
        notes: "Private",
        developers: [{ name: "Ann; Smith" }, { name: "Bob" }],
      },
    ],
    ["developers", "id"],
  );
  assert.equal(
    csv,
    '\uFEFF"ID";"Development Owners"\r\n"5";"Ann; Smith; Bob"\r\n',
  );
  assert.ok(!csv.includes("Private"));
  assert.throws(() => ticketsCsv([], []));
});
