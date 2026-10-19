import { z } from "zod";
import { Store } from "./store.js";

export const ticketListSchema = z.object({
  type: z.string().trim().max(200).optional(),
  state: z.string().trim().max(200).optional(),
  afterId: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(100).default(100),
});

export function listLocalTickets(store: Store, input: unknown) {
  const { type, state, afterId, limit } = ticketListSchema.parse(input);
  const clauses = ["source = ?"];
  const params: (string | number)[] = [store.source()];
  for (const [field, value] of [
    ["type", type],
    ["state", state],
  ]) {
    if (value) {
      clauses.push(`${field} = ? COLLATE NOCASE`);
      params.push(value);
    }
  }
  const where = clauses.join(" AND ");
  const { total } = store.db
    .prepare(`SELECT COUNT(*) AS total FROM tickets WHERE ${where}`)
    .get(...params) as { total: number };
  const rows = store.db
    .prepare(
      `SELECT id, title, type, state, assigned, synced_at FROM tickets WHERE ${where} AND id > ? ORDER BY id LIMIT ?`,
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
    filters: { type, state },
    total,
    tickets,
    hasMore,
    nextAfterId: hasMore ? tickets.at(-1)!.id : null,
  };
}
