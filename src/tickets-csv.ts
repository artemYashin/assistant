export type CsvTicket = {
  id: number;
  title?: string;
  type?: string;
  state?: string;
  priority?: number;
  tags?: string[];
};
function cell(value: string | number) {
  let text = String(value);
  // Keep untrusted ticket text as text when opened in spreadsheet software.
  if (/^[\s\u0000-\u001f]*[=+@-]/u.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
export function ticketsCsv(tickets: CsvTicket[]) {
  const rows: (string | number)[][] = [
    [
      "ID",
      "Название тикета",
      "Тип задачи",
      "Статус Azure DevOps",
      "Локальный приоритет",
      "Теги",
    ],
    ...tickets.map((t) => [
      t.id,
      t.title || "",
      t.type || "",
      t.state || "",
      t.priority ?? 1,
      (t.tags || []).join("; "),
    ]),
  ];
  return (
    "\uFEFF" + rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n"
  );
}
