import { z } from "zod";
import { Store } from "./store.js";

export const contentSearchSchema = z.object({
  search: z.string().trim().min(2).max(200),
  id: z.number().int().positive().optional(),
  afterId: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(30).default(15),
});

/** Local literal search only; never downloads ticket bodies or returns full content. */
export function searchTicketContent(store: Store, input: unknown) {
  const { search, id, afterId, limit } = contentSearchSchema.parse(input);
  const source = store.source();
  const rows = store.db.prepare(`SELECT t.id,t.title,c.section,c.body,c.updated_at
    FROM tickets t JOIN ticket_content_cache c ON c.source=t.source AND c.id=t.id
    WHERE t.source=? AND t.id>? AND (? IS NULL OR t.id=?) AND instr(c.search_text,?)>0
    ORDER BY t.id,c.section LIMIT ?`).all(source, afterId, id ?? null, id ?? null, search.toLocaleLowerCase(), (limit + 1) * 3) as any[];
  const matches = new Map<number, any>();
  for (const row of rows) {
    if (matches.has(row.id)) continue;
    const at = row.body.toLocaleLowerCase().indexOf(search.toLocaleLowerCase());
    const start = Math.max(0, at - 80), end = Math.min(row.body.length, at + search.length + 120);
    matches.set(row.id, { id: row.id, title: row.title, section: row.section,
      snippet: (start ? "…" : "") + row.body.slice(start, end) + (end < row.body.length ? "…" : "") });
  }
  const tickets = [...matches.values()].slice(0, limit);
  const coverage = store.db.prepare(`SELECT count(*) AS total,
    sum(EXISTS(SELECT 1 FROM ticket_content_cache c WHERE c.source=t.source AND c.id=t.id)) AS cached
    FROM tickets t WHERE source=? AND (? IS NULL OR t.id=?)`).get(source, id ?? null, id ?? null) as any;
  const hasMore = matches.size > limit;
  return { tickets, hasMore, nextAfterId: hasMore ? tickets.at(-1)!.id : null,
    coverage: { total: coverage.total, cached: coverage.cached || 0 },
    note: "Local cached descriptions/acceptance criteria/repro steps only; may be stale or incomplete. Literal substring matches, not verified semantic relationships. No Azure calls." };
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
  return { id, available: true, origin: "local_cache", content: content.slice(offset, end),
    offset, nextOffset: end < content.length ? end : null,
    missingSections: ["description", "criteria", "repro"].filter(section => !rows.some(row => row.section === section)),
    cachedAt: includeCacheInfo ? rows.map(row => ({ section: row.section, at: row.updated_at })) : undefined,
    note: "Cached text may be stale. No Azure calls. Continue with nextOffset for remaining text; missing sections are unknown, not empty." };
}
