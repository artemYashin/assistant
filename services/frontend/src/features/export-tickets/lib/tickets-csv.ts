import {
  defaultExportColumns,
  selectedExportColumns,
  type ExportColumnKey,
  type CsvTicket,
} from "./ticket-export-columns.js";
export type { CsvTicket } from "./ticket-export-columns.js";
function cell(value: string | number) {
  let text = String(value);
  // Keep untrusted ticket text as text when opened in spreadsheet software.
  // eslint-disable-next-line no-control-regex -- Remove control bytes from untrusted input/output.
  if (/^[\s\u0000-\u001f]*[=+@-]/u.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
export function ticketsCsv(tickets: CsvTicket[], keys: ExportColumnKey[] = defaultExportColumns) {
  const columns = selectedExportColumns(keys);
  const rows = [
    columns.map((column) => column.header),
    ...tickets.map((ticket) => columns.map((column) => column.value(ticket))),
  ];
  return "\uFEFF" + rows.map((row) => row.map(cell).join(";")).join("\r\n") + "\r\n";
}
