import { defaultExportColumns, selectedExportColumns, type CsvTicket, type ExportColumnKey } from "./ticket-export-columns.js";

function htmlCell(value: string | number): string {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
    .replace(/\r\n|\r|\n/g, "<br>");
}

/** Both clipboard representations describe the same selected export. */
export function ticketsClipboard(tickets: CsvTicket[], keys: ExportColumnKey[] = defaultExportColumns): { html: string; text: string } {
  if (!tickets.length || !keys.length) return { html: "", text: "" };
  const columns = selectedExportColumns(keys);
  const headers = columns.map(column => column.header);
  const rows = tickets.map(ticket => columns.map(column => column.value(ticket)));
  const row = (values: (string | number)[], tag: "th" | "td") =>
    `<tr>${values.map(value => `<${tag} style="border:1px solid #cbd5e1;padding:6px 10px;text-align:left;vertical-align:top;${tag === "th" ? "background-color:#f1f5f9;font-weight:bold;" : ""}">${htmlCell(value)}</${tag}>`).join("")}</tr>`;
  return {
    html: `<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px"><thead>${row(headers, "th")}</thead><tbody>${rows.map(values => row(values, "td")).join("")}</tbody></table>`,
    text: [headers, ...rows].map(values => values.map(value => String(value).replace(/[\t\r\n]+/g, " ")).join("\t")).join("\n"),
  };
}
