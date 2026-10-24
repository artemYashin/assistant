import { setTicketDeadline } from "./ticket-deadlines.js";
import { z } from "zod";
import { Store, AppError, type Context } from "./store.js";
export const metadataContext = z.object({
  client: z.string().max(200),
  project: z.string().max(200),
});
export const metadataPatch = z
  .object({
    localDeadline: z.string().datetime().nullable().optional(),
    notes: z.string().max(20000).optional(),
    priority: z.number().int().positive().safe().optional(),
    tags: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  })
  .strict();
export function ticketMetadata(
  store: Store,
  id: number,
  source = store.source(),
) {
  const row = store.db
    .prepare(
      "SELECT notes,priority,tags FROM ticket_metadata WHERE source=? AND id=?",
    )
    .get(source, id) as any;
  const localDeadline =
    (
      store.db
        .prepare(
          "SELECT deadline FROM ticket_deadlines WHERE source=? AND id=?",
        )
        .get(source, id) as any
    )?.deadline ?? null;
  return row
    ? {
        localDeadline,
        notes: row.notes,
        priority: row.priority,
        tags: JSON.parse(row.tags) as string[],
      }
    : { localDeadline, notes: "", priority: 1, tags: [] as string[] };
}
export function saveTicketMetadata(
  store: Store,
  id: number,
  source: string,
  context: Context,
  input: unknown,
) {
  if (source !== store.source())
    throw new AppError(409, "Подключение изменилось. Обновите список.");
  if (!store.hasLocalTicket(id, source))
    throw new AppError(404, "Тикет отсутствует в локальном списке");
  const patch = metadataPatch.parse(input);
  if (patch.localDeadline)
    patch.localDeadline = new Date(patch.localDeadline).toISOString();
  const value = { ...ticketMetadata(store, id, source), ...patch };
  value.tags = [...new Set(value.tags)];
  store.db.transaction(() => {
    store.db
      .prepare(
        "INSERT INTO ticket_metadata(source,id,notes,priority,tags) VALUES (?,?,?,?,?) ON CONFLICT(source,id) DO UPDATE SET notes=excluded.notes,priority=excluded.priority,tags=excluded.tags",
      )
      .run(source, id, value.notes, value.priority, JSON.stringify(value.tags));
    if (patch.localDeadline !== undefined)
      setTicketDeadline(store, id, source, patch.localDeadline);
  })();
  return value;
}

export function localTicketTags(store: Store, source = store.source()) {
  const rows = store.db
    .prepare(
      "SELECT m.tags FROM ticket_metadata m WHERE m.source=? AND (EXISTS (SELECT 1 FROM tickets t WHERE t.source=m.source AND t.id=m.id) OR EXISTS (SELECT 1 FROM ticket_trash t WHERE t.source=m.source AND t.id=m.id AND t.removed_at>?))",
    )
    .all(source, Date.now() - 30 * 86400000) as { tags: string }[];
  return [
    ...new Set(rows.flatMap((row) => JSON.parse(row.tags) as string[])),
  ].sort((a, b) => a.localeCompare(b));
}
