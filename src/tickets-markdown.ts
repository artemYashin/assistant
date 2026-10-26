import { defaultExportColumns, selectedExportColumns, type CsvTicket, type ExportColumnKey } from "./ticket-export-columns.js";

function cell(value: string | number): string {
  return String(value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/[\\`*_{}\[\]()#!|~]/g, "\\$&")
    .replace(/\r\n|\r|\n/g, "<br>");
}

/** Plain-text GFM table with the same values and ordering as file exports. */
export function ticketsMarkdown(tickets: CsvTicket[], keys: ExportColumnKey[] = defaultExportColumns): string {
  if (!keys.length || !tickets.length) return "";
  const columns = selectedExportColumns(keys);
  const row = (cells: (string | number)[]) => `| ${cells.map(cell).join(" | ")} |`;
  return [
    row(columns.map(column => column.header)),
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...tickets.map(ticket => row(columns.map(column => column.value(ticket)))),
  ].join("\n");
}
