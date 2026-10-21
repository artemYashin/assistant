import { z } from "zod";
import { Store } from "./store.js";

export const contentSearchSchema = z.object({
  search: z.string().trim().min(2).max(200),
  afterId: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(30).default(15),
});

/** Local literal search only; never downloads ticket bodies or returns full content. */
export function searchTicketContent(store: Store, input: unknown) {
  const { search, afterId, limit } = contentSearchSchema.parse(input);
  const source = store.source();
  const rows = store.db.prepare(`SELECT t.id,t.title,c.section,c.body,c.updated_at
    FROM tickets t JOIN ticket_content_cache c ON c.source=t.source AND c.id=t.id
    WHERE t.source=? AND t.id>? AND instr(c.search_text,?)>0
    ORDER BY t.id,c.section LIMIT ?`).all(source, afterId, search.toLocaleLowerCase(), (limit + 1) * 3) as any[];
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
    FROM tickets t WHERE source=?`).get(source) as any;
  const hasMore = matches.size > limit;
  return { tickets, hasMore, nextAfterId: hasMore ? tickets.at(-1)!.id : null,
    coverage: { total: coverage.total, cached: coverage.cached || 0 },
    note: "Local cached descriptions/acceptance criteria/repro steps only; may be stale or incomplete. Literal substring matches, not verified semantic relationships. No Azure calls." };
}
