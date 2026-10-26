import test from "node:test";
import assert from "node:assert/strict";
import { ticketExportFilename as name } from "../src/ticket-export-filename.js";
test("export names preserve automatic naming and use the selected extension", () => {
 const date = new Date(2026, 9, 26);
 assert.equal(name("", "xlsx", false, date), "orbit-tickets-2026-10-26.xlsx");
 assert.equal(name("  ", "csv", true, date), "orbit-tickets-trash-2026-10-26.csv");
 assert.equal(name("Спринт 12", "xlsx"), "Спринт 12.xlsx");
 assert.equal(name(" Отчёт.XLSX ", "csv"), "Отчёт.csv");
 assert.equal(name("Отчёт.csv.xlsx", "xlsx"), "Отчёт.xlsx");
});
test("download names cannot contain paths, controls or Windows device names", () => {
 assert.equal(name('../report:one\\two\n', 'xlsx'), '-report-one-two.xlsx');
 assert.equal(name('CON', 'csv'), '_CON.csv');
 assert.equal(name('nul.txt', 'csv'), '_nul.txt.csv');
 assert.equal(name('...', 'csv', false, new Date(2026,9,26)), 'orbit-tickets-2026-10-26.csv');
 assert.equal(name('a'.repeat(200), 'csv'), 'a'.repeat(100)+'.csv');
});
