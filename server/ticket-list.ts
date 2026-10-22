import { ticketSearchFilters } from "./ticket-catalog.js";
import { ticketOrder, ticketSortSchema } from "./ticket-sort.js";
import { localTicketScope } from "./local-ticket-scope.js";
import { ticketMetadata } from "./ticket-metadata.js";
import { LocalDevelopers } from "./local-developers.js";
import { z } from "zod";
import { AppError, Store } from "./store.js";

export const ticketListSchema = z.object({
  ...ticketSortSchema,
  lifecycle: z.enum(["all", "active", "deleted"]).default("all").describe("Include retained local trash by default; deleted=true marks trash results."),
  fields: z.array(z.enum(["type", "state", "assigned", "priority", "tags", "azureTags", "notes", "localDevelopers", "created_at", "changed_at", "added_at", "synced_at", "localUrl"])).max(13).default([]).describe("Extra output fields; id/title always included. Request only what the task needs. Filters work independently of output fields."),
  detail: z.enum(["summary", "full"]).default("summary"),
  contentOffset: z.number().int().nonnegative().default(0),
  ids: z.array(z.number().int().positive()).min(1).max(50).optional(),
  search: z.string().trim().min(1).max(300).optional(),
  ...ticketSearchFilters,
  priority: z.number().int().min(1).max(20).optional(),
  azureTag: z.string().trim().max(400).optional(),
  tag: z.string().trim().max(60).optional(),
  afterId: z.number().int().nonnegative().default(0).describe("Pagination cursor: use nextAfterId from the previous response with the same sort/filter settings; 0 starts a new search."),
  limit: z.number().int().min(1).max(100).default(100),
});

export function listLocalTickets(store: Store, input: unknown) {
  const {
    sortBy, sortDirection,
    lifecycle,
    detail,
    fields,
    ids,
    search,
    type,
    state,
    priority,
    tag,
    azureTag,
    afterId,
    limit,
  } = ticketListSchema.parse(input);
  if (detail === "full")
    throw new AppError(
      403,
      "Полное чтение доступно только по явной просьбе пользователя через чат",
    );
  const clauses = ["source = ?"];
  const params: (string | number)[] = [store.source()];
  if (lifecycle !== "all") clauses.push(lifecycle === "deleted" ? "deleted=1" : "deleted=0");
  if (ids) {
    clauses.push(`id IN (${ids.map(() => "?").join(",")})`);
    params.push(...ids);
  }
  if (search) {
    clauses.push(
      "(instr(lower(title), lower(?)) > 0 OR EXISTS (SELECT 1 FROM ticket_azure_tags a, json_each(a.tags) tag WHERE a.source=local_tickets.source AND a.id=local_tickets.id AND instr(lower(tag.value), lower(?)) > 0))",
    );
    params.push(search, search);
  }

  for (const [field, value] of [
    ["type", type],
    ["state", state],
  ]) {
    if (value) {
      clauses.push(`${field} = ? COLLATE NOCASE`);
      params.push(value);
    }
  }
  if (priority !== undefined) {
    clauses.push(
      "COALESCE((SELECT priority FROM ticket_metadata m WHERE m.source=local_tickets.source AND m.id=local_tickets.id),1)=?",
    );
    params.push(priority);
  }
  if (tag) {
    clauses.push(
      "EXISTS (SELECT 1 FROM ticket_metadata m,json_each(m.tags) tag WHERE m.source=local_tickets.source AND m.id=local_tickets.id AND tag.value=? COLLATE NOCASE)",
    );
    params.push(tag);
  }
  if (azureTag) {
    clauses.push(
      "EXISTS (SELECT 1 FROM ticket_azure_tags a, json_each(a.tags) tag WHERE a.source=local_tickets.source AND a.id=local_tickets.id AND tag.value=? COLLATE NOCASE)",
    );
    params.push(azureTag);
  }
  const where = clauses.join(" AND ");
  const { total } = store.db
    .prepare(`${localTicketScope()} SELECT COUNT(*) AS total FROM local_tickets WHERE ${where}`)
    .get(...params) as { total: number };
  const sorted = sortBy !== "id" || sortDirection !== "asc";
  const rows = sorted ? store.db.prepare(`${localTicketScope()}, ordered AS (
    SELECT t.*,row_number() OVER (ORDER BY ${ticketOrder(sortBy, sortDirection)}) AS position FROM local_tickets t
  ) SELECT * FROM ordered AS local_tickets WHERE ${where}
    AND position > coalesce((SELECT position FROM ordered WHERE source=? AND id=?),0) ORDER BY position LIMIT ?`)
    .all(...params, store.source(), afterId, limit + 1) as Record<string, any>[]
    : store.db.prepare(`${localTicketScope()} SELECT * FROM local_tickets WHERE ${where} AND id>? ORDER BY id LIMIT ?`)
      .all(...params, afterId, limit + 1) as Record<string, any>[];
  const tickets: Record<string, any>[] = [];
  let size = 0;
  for (const row of rows.slice(0, limit)) {
    const wanted = new Set(fields);
    const ticket: Record<string, any> = { id: row.id, title: row.title, ...(row.deleted ? { deleted: true } : {}) };
    for (const field of ["type", "state", "assigned", "changed_at", "synced_at"])
      if (wanted.has(field as typeof fields[number])) ticket[field] = row[field];
    if (fields.some(field => ["notes", "priority", "tags"].includes(field))) {
      const metadata = ticketMetadata(store, row.id);
      for (const field of ["notes", "priority", "tags"] as const)
        if (wanted.has(field)) ticket[field] = metadata[field];
    }
    if (wanted.has("added_at")) ticket.added_at = store.ticketAddedAt(row.id);
    if (wanted.has("created_at")) ticket.created_at = store.ticketCreatedAt(row.id);
    if (wanted.has("azureTags")) ticket.azureTags = store.azureTags(row.id);
    if (wanted.has("localDevelopers")) ticket.localDevelopers = new LocalDevelopers(store)
      .assigned(row.id).map(({ id, name }) => ({ id, name }));
    if (wanted.has("localUrl")) ticket.localUrl = `/tickets?${new URLSearchParams({ id: String(row.id), source: store.source() })}`;
    const shortenedFields: string[] = [];
    for (const [key, value] of Object.entries(ticket)) {
      if (key !== "localUrl" && typeof value === "string" && value.length > 300) {
        ticket[key] = value.slice(0, 300) + "…";
        shortenedFields.push(key);
      }
    }
    if (shortenedFields.length) ticket.shortenedFields = shortenedFields;
    const length = JSON.stringify(ticket).length + 1;
    if (tickets.length && size + length > 18000) break;
    tickets.push(ticket);
    size += length;
  }
  const hasMore = rows.length > tickets.length;
  return {
    scope: "local",
    sortBy, sortDirection,
    filters: { lifecycle, ids, search, type, state, priority, tag, azureTag },
    total,
    tickets,
    hasMore,
    nextAfterId: hasMore ? tickets.at(-1)!.id : null,
  };
}
