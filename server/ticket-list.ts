import { ticketMetadata } from "./ticket-metadata.js";
import { LocalDevelopers } from "./local-developers.js";
import { z } from "zod";
import { AppError, Store } from "./store.js";

export const ticketListSchema = z.object({
  detail: z.enum(["summary", "full"]).default("summary"),
  contentOffset: z.number().int().nonnegative().default(0),
  ids: z.array(z.number().int().positive()).min(1).max(50).optional(),
  search: z.string().trim().min(1).max(300).optional(),
  type: z.string().trim().max(200).optional(),
  state: z.string().trim().max(200).optional(),
  priority: z.number().int().min(1).max(20).optional(),
  azureTag: z.string().trim().max(400).optional(),
  tag: z.string().trim().max(60).optional(),
  afterId: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(100).default(100),
});

export function listLocalTickets(store: Store, input: unknown) {
  const {
    detail,
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
  if (ids) {
    clauses.push(`id IN (${ids.map(() => "?").join(",")})`);
    params.push(...ids);
  }
  if (search) {
    clauses.push(
      "(instr(lower(title), lower(?)) > 0 OR EXISTS (SELECT 1 FROM ticket_azure_tags a, json_each(a.tags) tag WHERE a.source=tickets.source AND a.id=tickets.id AND instr(lower(tag.value), lower(?)) > 0))",
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
      "COALESCE((SELECT priority FROM ticket_metadata m WHERE m.source=tickets.source AND m.id=tickets.id),1)=?",
    );
    params.push(priority);
  }
  if (tag) {
    clauses.push(
      "EXISTS (SELECT 1 FROM ticket_metadata m,json_each(m.tags) tag WHERE m.source=tickets.source AND m.id=tickets.id AND tag.value=? COLLATE NOCASE)",
    );
    params.push(tag);
  }
  if (azureTag) {
    clauses.push(
      "EXISTS (SELECT 1 FROM ticket_azure_tags a, json_each(a.tags) tag WHERE a.source=tickets.source AND a.id=tickets.id AND tag.value=? COLLATE NOCASE)",
    );
    params.push(azureTag);
  }
  const where = clauses.join(" AND ");
  const { total } = store.db
    .prepare(`SELECT COUNT(*) AS total FROM tickets WHERE ${where}`)
    .get(...params) as { total: number };
  const rows = store.db
    .prepare(
      `SELECT id, title, type, state, assigned, changed_at, synced_at FROM tickets WHERE ${where} AND id > ? ORDER BY id LIMIT ?`,
    )
    .all(...params, afterId, limit + 1) as Record<string, any>[];
  const tickets: Record<string, any>[] = [];
  let size = 0;
  for (const row of rows.slice(0, limit)) {
    const shortenedFields: string[] = [];
    const ticket = Object.fromEntries(
      Object.entries(row).map(([key, value]) => {
        if (typeof value === "string" && value.length > 300) {
          shortenedFields.push(key);
          return [key, value.slice(0, 300) + "…"];
        }
        return [key, value];
      }),
    );
    const metadata = ticketMetadata(store, row.id);
    Object.assign(ticket, metadata, {
      added_at: store.ticketAddedAt(row.id),
      created_at: store.ticketCreatedAt(row.id),
      azureTags: store.azureTags(row.id),
      notes: metadata.notes.slice(0, 300),
      notesTruncated: metadata.notes.length > 300,
    });
    ticket.localDevelopers = new LocalDevelopers(store)
      .assigned(row.id)
      .map(({ id, name }) => ({ id, name }));
    ticket.localUrl = `/tickets?${new URLSearchParams({ id: String(row.id), source: store.source() })}`;
    if (shortenedFields.length) ticket.shortenedFields = shortenedFields;
    const length = JSON.stringify(ticket).length + 1;
    if (tickets.length && size + length > 18000) break;
    tickets.push(ticket);
    size += length;
  }
  const hasMore = rows.length > tickets.length;
  return {
    scope: "local",
    filters: { ids, search, type, state, priority, tag, azureTag },
    total,
    tickets,
    hasMore,
    nextAfterId: hasMore ? tickets.at(-1)!.id : null,
  };
}
