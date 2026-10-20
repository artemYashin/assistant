export type CsvTicket = {
  id: number;
  imported?: boolean;
  title?: string;
  type?: string;
  state?: string;
  priority?: number;
  tags?: string[];
  azureTags?: string[];
  assigned?: string;
  developers?: { name: string }[];
  developer_name?: string;
  notes?: string;
  url?: string;
  added_at?: string | null;
};
export const exportColumns = [
  {
    key: "id",
    header: "ID",
    label: "Номер тикета",
    width: 13,
    value: (t: CsvTicket) => t.id,
  },
  {
    key: "title",
    header: "Title",
    label: "Название",
    width: 72,
    value: (t: CsvTicket) => t.title || "",
  },
  {
    key: "type",
    header: "Work Item Type",
    label: "Тип задачи",
    width: 23,
    value: (t: CsvTicket) => t.type || "",
  },
  {
    key: "state",
    header: "Azure DevOps Status",
    label: "Статус в Azure",
    width: 30,
    value: (t: CsvTicket) => t.state || "",
  },
  {
    key: "priority",
    header: "Local Priority",
    label: "Локальный приоритет",
    width: 23,
    value: (t: CsvTicket) => (t.imported === false ? "N/A" : (t.priority ?? 1)),
  },
  {
    key: "tags",
    header: "Tags",
    label: "Теги",
    width: 36,
    value: (t: CsvTicket) =>
      t.imported === false ? "N/A" : (t.tags || []).join("; "),
  },
  {
    key: "azureTags",
    header: "Azure Tags",
    label: "Azure теги",
    width: 36,
    value: (t: CsvTicket) => (t.azureTags || []).join("; "),
  },
  {
    key: "developers",
    header: "Development Owners",
    label: "Локальное поручение",
    width: 36,
    value: (t: CsvTicket) =>
      t.imported === false
        ? "N/A"
        : t.developers?.map((d) => d.name).join("; ") || t.developer_name || "",
  },
  {
    key: "assigned",
    header: "Azure DevOps Assignee",
    label: "Исполнитель в Azure",
    width: 36,
    value: (t: CsvTicket) => t.assigned || "",
  },
  {
    key: "notes",
    header: "Local Notes",
    label: "Локальные заметки",
    width: 60,
    value: (t: CsvTicket) => (t.imported === false ? "N/A" : t.notes || ""),
  },
  {
    key: "added_at",
    header: "Added to System (UTC)",
    label: "Добавлено в систему",
    width: 28,
    value: (t: CsvTicket) => (t.imported === false ? "N/A" : t.added_at || ""),
  },
  {
    key: "url",
    header: "Azure DevOps URL",
    label: "Ссылка на тикет",
    width: 50,
    value: (t: CsvTicket) => t.url || "",
  },
] as const;
export type ExportColumnKey = (typeof exportColumns)[number]["key"];
export const defaultExportColumns: ExportColumnKey[] = [
  "id",
  "title",
  "type",
  "state",
  "priority",
  "tags",
  "azureTags",
];
export function selectedExportColumns(keys: ExportColumnKey[]) {
  const columns = exportColumns.filter((column) => keys.includes(column.key));
  if (!columns.length) throw new Error("Select at least one column");
  return columns;
}
