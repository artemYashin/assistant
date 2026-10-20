import { z } from "zod";
import { AppError } from "./store.js";
const choices = z.array(z.string().max(200)).max(100).default([]);
export const azureBrowseSchema = z
  .object({
    source: z.string().max(2200),
    query: z.string().trim().max(200).default(""),
    typeFilter: choices,
    stateFilter: choices,
    assigneeFilter: choices,
    azureTagFilter: choices,
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
  const query = `SELECT [System.Id] FROM WorkItems WHERE ${clauses.join(" AND ")} ORDER BY [System.Id] DESC`;
  if (query.length > 30000)
    throw new AppError(
      400,
      "Слишком много условий поиска. Сократите набор фильтров.",
    );
  return query;
}
export const browseFields = [
  "System.Id",
  "System.TeamProject",
  "System.Title",
  "System.WorkItemType",
  "System.State",
  "System.AssignedTo",
  "System.Tags",
  "System.ChangedDate",
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
    azureTags: String(f["System.Tags"] || "")
      .split(";")
      .map((v) => v.trim())
      .filter(Boolean),
    changed_at: f["System.ChangedDate"],
    url: `${base}/${encodeURIComponent(project)}/_workitems/edit/${item.id}`,
  };
}
