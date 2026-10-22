import { ticketSearchFilters } from "./ticket-catalog.js";
import { ticketOrder, ticketSortSchema } from "./ticket-sort.js";
import { localTicketScope } from "./local-ticket-scope.js";
import { z } from "zod";
import { Store } from "./store.js";

export const contentSearchSchema = z.object({
  ...ticketSortSchema,
  ...ticketSearchFilters,
  lifecycle: z.enum(["all", "active", "deleted"]).default("all"),
  search: z.string().trim().min(2).max(200),
  id: z.number().int().positive().optional(),
  afterId: z.number().int().nonnegative().default(0).describe("Pagination cursor: use nextAfterId from the previous response with the same sort/filter settings; 0 starts a new search."),
  limit: z.number().int().min(1).max(30).default(15),
});

/** Local literal search only; never downloads ticket bodies or returns full content. */
export function searchTicketContent(store: Store, input: unknown) {
  const { search, id, afterId, limit, lifecycle, sortBy, sortDirection, type, state } = contentSearchSchema.parse(input);
  const source = store.source();
  const lifecycleClause = lifecycle === "all" ? "" : lifecycle === "deleted" ? " AND t.deleted=1" : " AND t.deleted=0";
  const filterClause = `${type ? " AND t.type=? COLLATE NOCASE" : ""}${state ? " AND t.state=? COLLATE NOCASE" : ""}`;
  const filterParams = [...(type ? [type] : []), ...(state ? [state] : [])];
  const query = search.toLocaleLowerCase();
  const sorted = sortBy !== "id" || sortDirection !== "asc";
  const rows = store.db.prepare(`${localTicketScope()}, ordered AS (
    SELECT t.*, row_number() OVER (ORDER BY ${ticketOrder(sortBy, sortDirection)}) AS position
    FROM local_tickets t WHERE t.source=?
  ) SELECT t.id,t.title,t.deleted,coalesce(m.notes,'') AS notes FROM ordered t
    LEFT JOIN ticket_metadata m ON m.source=t.source AND m.id=t.id
    WHERE (? IS NULL OR t.id=?) ${lifecycleClause} ${filterClause}
      AND ${sorted ? "t.position > coalesce((SELECT position FROM ordered WHERE id=?),0)" : "t.id>?"}
      AND (coalesce(m.notes,'')<>'' OR EXISTS(SELECT 1 FROM ticket_content_cache c WHERE c.source=t.source AND c.id=t.id AND instr(c.search_text,?)>0))
    ORDER BY t.position`).iterate(source, id ?? null, id ?? null, ...filterParams, afterId, query);
  const cached = store.db.prepare("SELECT section,body FROM ticket_content_cache WHERE source=? AND id=? AND instr(search_text,?)>0 ORDER BY section LIMIT 1");
  const matches = new Map<number, any>();
  for (const value of rows) {
    const row = value as any;
    // Keep only one matching body at a time. Notes use JS Unicode case folding.
    const match = cached.get(source, row.id, query) as { section: string; body: string } | undefined;
    const body = match?.body ?? row.notes;
    const at = body.toLocaleLowerCase().indexOf(query);
    if (at < 0) continue;
    const start = Math.max(0, at - 80), end = Math.min(body.length, at + search.length + 120);
    matches.set(row.id, { id: row.id, title: row.title, ...(row.deleted ? { deleted: true } : {}), section: match?.section ?? "notes",
      snippet: (start ? "…" : "") + body.slice(start, end) + (end < body.length ? "…" : "") });
    if (matches.size > limit) break;
  }
  const tickets = [...matches.values()].slice(0, limit);
  const coverage = store.db.prepare(`${localTicketScope()} SELECT count(*) AS total,
    sum(EXISTS(SELECT 1 FROM ticket_content_cache c WHERE c.source=t.source AND c.id=t.id)) AS cached
    FROM local_tickets t WHERE source=? AND (? IS NULL OR t.id=?) ${lifecycleClause} ${filterClause}`).get(source, id ?? null, id ?? null, ...filterParams) as any;
  const hasMore = matches.size > limit;
  return { tickets, sortBy, sortDirection, hasMore, nextAfterId: hasMore ? tickets.at(-1)!.id : null,
    coverage: { total: coverage.total, cached: coverage.cached || 0 },
    note: "Local notes and cached descriptions/acceptance criteria/repro steps; coverage.cached counts only Azure body caches; may be stale or incomplete. Literal substring matches, not verified semantic relationships. No Azure calls." };
}

export const cachedTicketSchema = z.object({
  id: z.number().int().positive(),
  includeCacheInfo: z.boolean().default(false),
  offset: z.number().int().nonnegative().default(0),
});

/** Complete cached text, paged to avoid silently truncating oversized tickets. */
export function readCachedTicket(store: Store, input: unknown) {
  const { id, offset, includeCacheInfo } = cachedTicketSchema.parse(input);
  const source = store.source();
  if (!store.hasLocalTicket(id, source))
    return { id, available: false, reason: "Ticket is not local. No Azure request was made." };
  const rows = store.db.prepare("SELECT section,body,updated_at FROM ticket_content_cache WHERE source=? AND id=? ORDER BY section")
    .all(source, id) as { section: string; body: string; updated_at: string }[];
  if (!rows.length)
    return { id, available: false, reason: "No cached content yet. No Azure request was made. Ask before fetching missing content from Azure." };
  const content = rows.map(row => `${row.section}:\n${row.body}`).join("\n\n");
  const end = Math.min(content.length, offset + 3000);
  const lifecycle = store.db.prepare(`${localTicketScope()} SELECT deleted FROM local_tickets WHERE source=? AND id=?`).get(source, id) as { deleted: number } | undefined;
  return { id, available: true, deleted: lifecycle?.deleted ? true : undefined, origin: "local_cache", content: content.slice(offset, end),
    offset, nextOffset: end < content.length ? end : null,
    missingSections: ["description", "criteria", "repro"].filter(section => !rows.some(row => row.section === section)),
    cachedAt: includeCacheInfo ? rows.map(row => ({ section: row.section, at: row.updated_at })) : undefined,
    note: "Cached text may be stale. No Azure calls. Continue with nextOffset for remaining text; missing sections are unknown, not empty." };
}
