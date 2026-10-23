import { azurePriorityValue, AZURE_PRIORITY_FIELD } from "./azure-priority.js";
import { z } from "zod";
import { AppError } from "./store.js";
const azureSortFields: Record<string, string> = {
  id: "System.Id",
  title: "System.Title",
  type: "System.WorkItemType",
  state: "System.State",
  assigned: "System.AssignedTo",
  azurePriority: AZURE_PRIORITY_FIELD,
  azureTags: "System.Tags",
  created_at: "System.CreatedDate",
  changed_at: "System.ChangedDate",
};
const localSortFields = new Set([
  "priority",
  "tags",
  "developer_name",
  "added_at",
  "synced_at",
]);
const sortSchema = z
  .string()
  .refine((value) => {
    const [key, direction, extra] = value.split("-");
    return (
      !extra &&
      (direction === "asc" || direction === "desc") &&
      (Object.hasOwn(azureSortFields, key) || localSortFields.has(key))
    );
  }, "Неизвестная сортировка")
  .default("id-desc");
const choices = z.array(z.string().max(200)).max(100).default([]);
export const azureBrowseSchema = z
  .object({
    source: z.string().max(2200),
    sort: sortSchema,
    query: z.string().trim().max(200).default(""),
    typeFilter: choices,
    stateFilter: choices,
    assigneeFilter: choices,
    azureTagFilter: choices,
    azurePriorityFilter: z.array(z.string().regex(/^(?:\d+)?$/).max(16)).max(100).default([]),
    priorityFilter: choices,
    tagFilter: choices,
    localFilter: choices,
    before: z.number().int().positive().optional(),
    page: z.number().int().min(1).max(400).default(1),
    snapshot: z.string().uuid().optional(),
  })
  .strict();
export type AzureBrowse = z.infer<typeof azureBrowseSchema>;
export function browseQuery(input: AzureBrowse, local: any[]) {
  const quote = (s: string) => "'" + s.replace(/'/g, "''") + "'";
  const clauses = ["[System.TeamProject] = @project"];
  if (input.before) clauses.push(`[System.Id] < ${input.before}`);
  if (input.query) {
    const id = /^#?\d+$/.test(input.query)
      ? Number(input.query.replace("#", ""))
      : null;
    if (id !== null && (!Number.isSafeInteger(id) || id <= 0))
      throw new AppError(400, "Некорректный номер тикета");
    clauses.push(
      id
        ? `[System.Id] = ${id}`
        : `([System.Title] CONTAINS ${quote(input.query)} OR [System.Tags] CONTAINS ${quote(input.query)})`,
    );
  }
  for (const [field, values] of [
    ["System.WorkItemType", input.typeFilter],
    ["System.State", input.stateFilter],
    ["System.AssignedTo", input.assigneeFilter],
  ] as const) {
    if (values.length)
      clauses.push(
        `(${values.map((v) => `[${field}] = ${quote(v)}`).join(" OR ")})`,
      );
  }
  if (input.azurePriorityFilter.length)
    clauses.push(`(${input.azurePriorityFilter.map(v => v === "" ? `[${AZURE_PRIORITY_FIELD}] = ''` : `[${AZURE_PRIORITY_FIELD}] = ${Number(v)}`).join(" OR ")})`);
  if (input.azureTagFilter.length)
    clauses.push(
      `(${input.azureTagFilter.map((v) => (v ? `[System.Tags] CONTAINS ${quote(v)}` : "[System.Tags] = ''")).join(" OR ")})`,
    );
  if (
    input.priorityFilter.length ||
    input.tagFilter.length ||
    input.localFilter.length
  ) {
    const ids = local
      .filter(
        (t) =>
          (!input.priorityFilter.length ||
            input.priorityFilter.includes(String(t.priority ?? 1))) &&
          (!input.tagFilter.length ||
            input.tagFilter.some((v) =>
              v ? t.tags?.includes(v) : !t.tags?.length,
            )) &&
          (!input.localFilter.length ||
            input.localFilter.some((v) =>
              v
                ? t.developers?.some((d: any) => d.id === v)
                : !t.developers?.length,
            )),
      )
      .map((t) => t.id);
    if (!ids.length) return null;
    if (ids.length > 2000)
      throw new AppError(
        400,
        "Локальный фильтр охватывает более 2000 задач. Сузьте условия.",
      );
    clauses.push(`[System.Id] IN (${ids.join(",")})`);
  }
  const [sortKey, direction] = input.sort.split("-");
  const field = azureSortFields[sortKey];
  const order = field
    ? `[${field}] ${direction.toUpperCase()}${sortKey === "id" ? "" : ", [System.Id] DESC"}`
    : "[System.Id] DESC";
  const query = `SELECT [System.Id] FROM WorkItems WHERE ${clauses.join(" AND ")} ORDER BY ${order}`;
  if (query.length > 30000)
    throw new AppError(
      400,
      "Слишком много условий поиска. Сократите набор фильтров.",
    );
  return query;
}
export const browseFields = [
  AZURE_PRIORITY_FIELD,
  "System.Id",
  "System.TeamProject",
  "System.Title",
  "System.WorkItemType",
  "System.State",
  "System.AssignedTo",
  "System.Tags",
  "System.ChangedDate",
  "System.CreatedDate",
];
export function azureSummary(
  item: any,
  source: string,
  base: string,
  project: string,
) {
  const f = item.fields || {};
  return {
    id: item.id,
    source,
    title: f["System.Title"] || "",
    type: f["System.WorkItemType"] || "",
    state: f["System.State"] || "",
    assigned:
      typeof f["System.AssignedTo"] === "string"
        ? f["System.AssignedTo"]
        : f["System.AssignedTo"]?.displayName || "",
    azurePriority: azurePriorityValue(f[AZURE_PRIORITY_FIELD]),
    azureTags: String(f["System.Tags"] || "")
      .split(";")
      .map((v) => v.trim())
      .filter(Boolean),
    changed_at: f["System.ChangedDate"],
    created_at: f["System.CreatedDate"] || null,
    url: `${base}/${encodeURIComponent(project)}/_workitems/edit/${item.id}`,
  };
}

// Azure owns remote-field ordering. Local fields are sorted over the entire ID
// index before pagination, using local metadata only (unknown values go last).
export function orderBrowseIds(ids: number[], sort: string, local: any[]) {
  const unique = [...new Set(ids)];
  const [key, direction] = sort.split("-");
  if (!localSortFields.has(key)) return unique;
  const byId = new Map(local.map((ticket) => [ticket.id, ticket]));
  const value = (id: number): string | number | null => {
    const ticket = byId.get(id);
    if (!ticket) return null;
    if (key === "priority") return ticket.priority ?? 1;
    if (key === "tags") return (ticket.tags || []).join("; ");
    if (key === "developer_name") return ticket.developer_name || "";
    const date = Date.parse(ticket[key]);
    return Number.isFinite(date) ? date : null;
  };
  return unique.sort((a, b) => {
    const av = value(a),
      bv = value(b);
    if (av === null || bv === null)
      return av === bv ? b - a : av === null ? 1 : -1;
    const cmp =
      typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv), "ru", { numeric: true });
    return (direction === "desc" ? -cmp : cmp) || b - a;
  });
}
