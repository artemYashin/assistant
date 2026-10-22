import { z } from "zod";
import { Store } from "./store.js";
import { localTicketScope } from "./local-ticket-scope.js";

const exactValues = z.union([
  z.array(z.string().trim().min(1).max(200)).max(50),
  z.string().trim().min(1).max(200),
]);
export const ticketSearchFilters = {
  type: exactValues.optional().describe("Exact Azure work item types: pass an array, OR within it. A single string is accepted for compatibility. Empty array/omitted means no type filter. AND with state and other filters. Use get_ticket_catalog for known values."),
  state: exactValues.optional().describe("Exact Azure workflow statuses: pass an array, OR within it. A single string is accepted for compatibility. Empty array/omitted means no state filter. AND with type and other filters; not local lifecycle. Use get_ticket_catalog for known values."),
};

/** Bound values only; arrays use OR and separate fields use AND. */
export function ticketFilterSql(type?: string | string[], state?: string | string[], alias: "" | "t." = "") {
  const clauses: string[] = [], params: string[] = [];
  for (const [field, input] of [["type", type], ["state", state]] as const) {
    const values = [...new Set((Array.isArray(input) ? input : input ? [input] : []))];
    if (!values.length) continue;
    clauses.push(`${alias}${field} COLLATE NOCASE IN (${values.map(() => "?").join(",")})`);
    params.push(...values);
  }
  return { clauses, params };
}


const tagValues = (max: number) => z.union([z.array(z.string().trim().min(1).max(max)).max(50), z.string().trim().min(1).max(max)]);
export const ticketMetadataFilters = {
  priority: z.union([z.array(z.number().int().min(1).max(20)).max(20), z.number().int().min(1).max(20)]).optional().describe("Local priorities, OR within array; 1 is highest. Single number supported. Empty/omitted means no filter."),
  tag: tagValues(60).optional().describe("Exact local tags: match ANY listed tag. Single string supported. Empty/omitted means no filter; AND with other fields."),
  azureTag: tagValues(400).optional().describe("Exact Azure tags: match ANY listed tag. Single string supported. Empty/omitted means no filter; AND with other fields."),
};
export function ticketMetadataFilterSql(input: z.infer<z.ZodObject<typeof ticketMetadataFilters>>, alias: "t" | "local_tickets") {
  const clauses: string[] = [], params: (string | number)[] = [];
  const values = <T extends string | number>(input: T | T[] | undefined): T[] => [...new Set(Array.isArray(input) ? input : input === undefined ? [] : [input])];
  const priorities = values(input.priority);
  if (priorities.length) {
    clauses.push(`COALESCE((SELECT priority FROM ticket_metadata m WHERE m.source=${alias}.source AND m.id=${alias}.id),1) IN (${priorities.map(() => "?").join(",")})`);
    params.push(...priorities);
  }
  for (const [field, table] of [["tag", "ticket_metadata"], ["azureTag", "ticket_azure_tags"]] as const) {
    const tags = values(input[field]);
    if (!tags.length) continue;
    clauses.push(`EXISTS (SELECT 1 FROM ${table} m,json_each(m.tags) tag WHERE m.source=${alias}.source AND m.id=${alias}.id AND tag.value COLLATE NOCASE IN (${tags.map(() => "?").join(",")}))`);
    params.push(...tags);
  }
  return { clauses, params };
}

/** Cached process definitions plus locally observed values; never requests Azure. */
export function getTicketCatalog(store: Store) {
  const source = store.source();
  const saved = store.get<unknown>("azure.ticket-options:" + source, []);
  const cached = z.array(z.object({ name: z.string(), states: z.array(z.string()) })).safeParse(saved);
  const types = new Map<string, Set<string>>();
  const add = (name: string, states: string[]) => {
    if (!name) return;
    const values = types.get(name) ?? new Set<string>();
    for (const state of states) if (state) values.add(state);
    types.set(name, values);
  };
  for (const entry of cached.success ? cached.data : []) add(entry.name, entry.states);
  const rows = store.db.prepare(`${localTicketScope()} SELECT DISTINCT type,state FROM local_tickets WHERE source=?`).all(source) as { type: string; state: string }[];
  for (const row of rows) add(row.type, [row.state]);
  return {
    types: [...types].sort(([a], [b]) => a.localeCompare(b)).map(([type, states]) => ({ type, states: [...states].sort() })),
    azureCatalogCached: cached.success && cached.data.length > 0,
    note: "Cached Azure types/statuses plus locally observed values, including retained trash. May be incomplete or stale; no Azure request. state is Azure status; lifecycle is active/deleted/all locally.",
  };
}
