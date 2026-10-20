import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { ticketsXlsx } from "../src/tickets-xlsx.js";

test("Excel export round-trips ordered tickets as values with formatting", async () => {
  const bytes = await ticketsXlsx(
    [
      {
        id: 42,
        title: '=HYPERLINK("url")',
        type: "Bug",
        state: "Active",
        priority: 2,
        tags: ["UI", "API"],
        azureTags: ["Customer", "Backend"],
      },
      { id: 7, title: 'Ошибка; "текст"\nследующая строка' },
    ],
    true,
  );
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(
    bytes as unknown as Parameters<typeof book.xlsx.load>[0],
  );
  const sheet = book.getWorksheet("Trash")!;
  assert.equal(sheet.rowCount, 3);
  assert.equal(sheet.getCell("A2").value, 42);
  assert.equal(sheet.getCell("A3").value, 7);
  assert.equal(sheet.getCell("B2").value, '=HYPERLINK("url")');
  assert.equal(sheet.getCell("B2").type, ExcelJS.ValueType.String);
  assert.equal(sheet.getCell("F2").value, "UI; API");
  assert.equal(sheet.getCell("G1").value, "Azure Tags");
  assert.equal(sheet.getCell("G2").value, "Customer; Backend");
  assert.equal(sheet.getCell("G3").value, "");
  assert.equal(sheet.getCell("E3").value, 1);
  assert.equal(sheet.getCell("A2").font.bold, true);
  assert.equal(sheet.getCell("B1").font.bold, true);
  assert.equal(sheet.getCell("B3").alignment.wrapText, true);
  assert.equal(sheet.views[0].state, "frozen");
  assert.ok(sheet.autoFilter);
  assert.ok(sheet.getColumn(2).width! > sheet.getColumn(1).width!);
});

test("Excel selected columns retain styling by field and omit unselected data", async () => {
  const bytes = await ticketsXlsx(
    [
      {
        id: 1,
        title: "Hidden",
        notes: "Private",
        priority: 3,
        developers: [{ name: "Ann" }, { name: "Bob" }],
      },
    ],
    false,
    ["priority", "developers"],
  );
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(
    bytes as unknown as Parameters<typeof book.xlsx.load>[0],
  );
  const sheet = book.getWorksheet("Tickets")!;
  assert.equal(sheet.columnCount, 2);
  assert.equal(sheet.getCell("A1").value, "Local Priority");
  assert.equal(sheet.getCell("B1").value, "Development Owners");
  assert.equal(sheet.getCell("A2").value, 3);
  assert.equal(sheet.getCell("A2").font.bold, true);
  assert.equal(sheet.getCell("B2").value, "Ann; Bob");
  assert.equal(!!sheet.getCell("B2").font.bold, false);
  assert.equal(sheet.autoFilter, "A1:B2");
});
